import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { decideGeneration } from "../../shared/generation";
import {
  buildMpvArguments,
  createControlCommand,
  createGetPropertyCommand,
  createLoadfileCommand,
  createMpvPipeName,
  createObservePropertyCommand,
  createPlaylistStepCommand,
  serializeMpvCommand,
  type MpvCommand,
} from "./commands";
import { JsonLineParser } from "./json-lines";
import type { LocalPlaybackInput } from "./playback-input";
import type { VerifiedMpvRuntime } from "./runtime-manifest";
import {
  StructuredPlaybackLogger,
  type StructuredLogValue,
} from "./structured-log";

const REQUIRED_MPV_EVENTS = new Set([
  "start-file",
  "file-loaded",
  "playback-restart",
  "video-reconfig",
  "audio-reconfig",
  "end-file",
]);
const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const REPLACEMENT_DELAY_MS = 250;

type TrackedCommandKind =
  | "geometry-height"
  | "geometry-width"
  | "heartbeat"
  | "loadfile"
  | "observe-paused-for-cache"
  | "playlist-position"
  | "playlist-step";

interface PendingCommand {
  generation: number;
  instanceId: number;
  kind: TrackedCommandKind;
}

interface OwnedMpvInstance {
  child: ChildProcess;
  endFileWaiters: Array<() => void>;
  exitPromise: Promise<void>;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  heartbeatRequestId: number | null;
  heartbeatTimeout: ReturnType<typeof setTimeout> | null;
  id: number;
  intentionalStop: boolean;
  pipeName: string;
  processExited: boolean;
  resolveExit: () => void;
  socket: Socket | null;
}

export interface WindowGeometrySample {
  displayId: number;
  height: number;
  reason: string;
  scaleFactor: number;
  state: string;
  width: number;
  x: number;
  y: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), milliseconds);
  });
  const result = await Promise.race([promise, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

function normalizedCode(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/i.test(value)
    ? value
    : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function openPipe(pipeName: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipeName);
    const onError = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

async function connectToPipe(
  pipeName: string,
  processExited: () => boolean,
  timeoutMilliseconds = 5_000,
): Promise<Socket> {
  const deadline = performance.now() + timeoutMilliseconds;
  while (performance.now() < deadline) {
    if (processExited()) throw new Error("mpv-exited-before-ipc");
    try {
      return await openPipe(pipeName);
    } catch {
      await delay(100);
    }
  }
  throw new Error("mpv-ipc-timeout");
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function canConnectToPipe(pipeName: string): Promise<boolean> {
  return withTimeout(
    openPipe(pipeName).then(
      (socket) => {
        socket.destroy();
        return true;
      },
      () => false,
    ),
    300,
    false,
  );
}

async function forceKillTree(processId: number): Promise<void> {
  if (process.platform !== "win32") return;
  await withTimeout(
    new Promise<void>((resolve) => {
      const taskkill = spawn(
        "taskkill.exe",
        ["/pid", String(processId), "/t", "/f"],
        {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      taskkill.once("error", () => resolve());
      taskkill.once("exit", () => resolve());
    }),
    1_500,
    undefined,
  );
}

export class MpvController {
  private generation = 0;
  private confirmedGeneration = 0;
  private active: OwnedMpvInstance | null = null;
  private input: LocalPlaybackInput | null = null;
  private instanceSequence = 0;
  private requestSequence = 10_000;
  private readonly pendingCommands = new Map<number, PendingCommand>();
  private readonly ownedTargets: Array<{
    pipeName: string;
    processId: number;
  }> = [];
  private replacementAttempts = 0;
  private replacementArmed = false;
  private replacementTimer: ReturnType<typeof setTimeout> | null = null;
  private replacementStartedAt = 0;
  private shutdownPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private stackingSynchronizationInFlight = false;

  constructor(
    private readonly runtime: VerifiedMpvRuntime,
    private readonly logger: StructuredPlaybackLogger,
    private readonly nativeWindowId: string,
    private readonly windowStackingHelperPath: string,
  ) {}

  async start(input: LocalPlaybackInput): Promise<void> {
    this.input = input;
    this.generation = 1;
    const instance = await this.spawnAndConnect("initial");
    this.sendLoad(instance);
    this.replacementArmed = true;
  }

  private async spawnAndConnect(reason: "initial" | "replacement") {
    const pipeName = createMpvPipeName(process.pid);
    const arguments_ = buildMpvArguments(pipeName, this.nativeWindowId);
    const child = spawn(this.runtime.executablePath, arguments_, {
      detached: false,
      shell: false,
      stdio: "ignore",
      windowsHide: false,
    });
    let resolveExit = (): void => undefined;
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const instance: OwnedMpvInstance = {
      child,
      endFileWaiters: [],
      exitPromise,
      heartbeatInterval: null,
      heartbeatRequestId: null,
      heartbeatTimeout: null,
      id: ++this.instanceSequence,
      intentionalStop: false,
      pipeName,
      processExited: false,
      resolveExit,
      socket: null,
    };
    this.active = instance;
    if (child.pid) {
      this.ownedTargets.push({ pipeName, processId: child.pid });
    }
    this.logger.write("mpv-spawned", this.generation, {
      processId: child.pid ?? null,
      transport: this.input?.transport ?? "unknown",
      mpvCommit: this.runtime.manifest.source.mpvCommit,
      ffmpegCommit: this.runtime.manifest.source.ffmpegCommit,
      spawnReason: reason,
    });

    const markExited = (): void => this.markExited(instance);
    child.once("exit", markExited);
    child.once("error", () => {
      this.logger.write("mpv-process-error", this.generation, {
        reason: "spawn-error",
      });
      markExited();
    });

    try {
      instance.socket = await connectToPipe(
        pipeName,
        () => instance.processExited,
      );
      if (this.active !== instance || this.shuttingDown) {
        throw new Error("mpv-instance-superseded");
      }
      this.listenToIpc(instance);
      this.logger.write("mpv-ipc-connected", this.generation, {
        instanceId: instance.id,
      });
      this.sendTracked(
        instance,
        "observe-paused-for-cache",
        this.generation,
        (id) => createObservePropertyCommand("paused-for-cache", id),
      );
      this.startHeartbeat(instance);
      if (!(await this.synchronizeWindowStacking(instance))) {
        throw new Error("mpv-window-stacking-failed");
      }
      this.logger.write("mpv-window-stacking-synchronized", this.generation, {
        instanceId: instance.id,
      });
      return instance;
    } catch (error) {
      instance.intentionalStop = true;
      await this.terminateInstance(instance, false);
      throw error;
    }
  }

  private markExited(instance: OwnedMpvInstance): void {
    if (instance.processExited) return;
    instance.processExited = true;
    this.stopHeartbeat(instance);
    instance.socket?.destroy();
    instance.socket = null;
    this.removePendingCommands(instance.id);
    this.logger.write("mpv-process-exit", this.generation, {
      exitCode: instance.child.exitCode,
      instanceId: instance.id,
      signal: normalizedCode(instance.child.signalCode),
    });
    instance.resolveExit();

    if (
      this.active === instance &&
      this.replacementArmed &&
      !instance.intentionalStop &&
      !this.shuttingDown
    ) {
      this.scheduleReplacement("unexpected-exit");
    }
  }

  private listenToIpc(instance: OwnedMpvInstance): void {
    const parser = new JsonLineParser();
    const socket = instance.socket;
    if (!socket) return;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      for (const result of parser.push(chunk)) {
        if (!result.ok) {
          this.logger.write("mpv-ipc-parse-error", this.generation, {
            reason: result.reason,
          });
          continue;
        }
        this.handleIpcMessage(instance, result.value);
      }
    });
    socket.on("error", () => {
      if (!instance.processExited && !this.shuttingDown) {
        this.logger.write("mpv-ipc-error", this.generation, {
          reason: "socket-error",
        });
      }
    });
    socket.on("close", () => {
      this.logger.write("mpv-ipc-closed", this.generation, {
        instanceId: instance.id,
      });
      if (
        this.active === instance &&
        !instance.processExited &&
        !instance.intentionalStop &&
        !this.shuttingDown
      ) {
        void this.replaceUnresponsiveInstance(instance, "ipc-closed");
      }
    });
  }

  private handleIpcMessage(instance: OwnedMpvInstance, message: unknown): void {
    if (!isRecord(message) || this.active !== instance) return;
    if (
      message.event === "property-change" &&
      message.name === "paused-for-cache" &&
      typeof message.data === "boolean"
    ) {
      const eventGeneration = this.confirmedGeneration || this.generation;
      this.logger.write("mpv-cache-state", eventGeneration, {
        accepted:
          decideGeneration(this.generation, eventGeneration) === "current",
        pausedForCache: message.data,
      });
      return;
    }
    if (
      typeof message.event === "string" &&
      REQUIRED_MPV_EVENTS.has(message.event)
    ) {
      const eventGeneration = this.confirmedGeneration || this.generation;
      const details: Record<string, StructuredLogValue> = {
        accepted:
          decideGeneration(this.generation, eventGeneration) === "current",
        latestGeneration: this.generation,
        mpvEvent: message.event,
      };
      if (message.event === "end-file") {
        details.reason = normalizedCode(message.reason);
        for (const resolve of instance.endFileWaiters.splice(0)) resolve();
      }
      this.logger.write("mpv-event", eventGeneration, details);
      if (
        message.event === "video-reconfig" ||
        message.event === "playback-restart"
      ) {
        this.requestWindowStackingSynchronization(instance);
      }
      return;
    }

    if (typeof message.request_id === "number") {
      this.handleCommandResult(instance, message.request_id, message);
    }
  }

  private handleCommandResult(
    instance: OwnedMpvInstance,
    requestId: number,
    message: Record<string, unknown>,
  ): void {
    const pending = this.pendingCommands.get(requestId);
    if (!pending || pending.instanceId !== instance.id) return;
    this.pendingCommands.delete(requestId);
    const result = normalizedCode(message.error);

    if (pending.kind === "heartbeat") {
      if (instance.heartbeatRequestId === requestId) {
        instance.heartbeatRequestId = null;
        if (instance.heartbeatTimeout) clearTimeout(instance.heartbeatTimeout);
        instance.heartbeatTimeout = null;
      }
      return;
    }

    const decision = decideGeneration(this.generation, pending.generation);
    const details: Record<string, StructuredLogValue> = {
      accepted: decision === "current",
      command: pending.kind,
      latestGeneration: this.generation,
      result,
    };
    if (
      pending.kind === "playlist-position" &&
      typeof message.data === "number" &&
      Number.isSafeInteger(message.data)
    ) {
      details.playlistPosition = message.data;
    }
    this.logger.write("mpv-command-result", pending.generation, details);

    if (decision !== "current" || result !== "success") return;
    if (pending.kind === "loadfile") {
      this.confirmedGeneration = pending.generation;
      return;
    }
    if (pending.kind === "playlist-step") {
      this.sendTracked(
        instance,
        "playlist-position",
        pending.generation,
        (id) => createGetPropertyCommand("playlist-pos", id),
      );
      return;
    }
    if (
      pending.kind === "playlist-position" &&
      typeof message.data === "number" &&
      Number.isSafeInteger(message.data)
    ) {
      this.confirmedGeneration = pending.generation;
      this.logger.write("mpv-generation-current", pending.generation, {
        playlistPosition: message.data,
      });
    }
  }

  private sendTracked(
    instance: OwnedMpvInstance,
    kind: TrackedCommandKind,
    generation: number,
    create: (requestId: number) => MpvCommand,
  ): number {
    const requestId = ++this.requestSequence;
    this.pendingCommands.set(requestId, {
      generation,
      instanceId: instance.id,
      kind,
    });
    if (!this.send(instance, create(requestId))) {
      this.pendingCommands.delete(requestId);
      throw new Error("mpv-not-ready");
    }
    return requestId;
  }

  private send(instance: OwnedMpvInstance, command: MpvCommand): boolean {
    if (
      this.active !== instance ||
      instance.processExited ||
      !instance.socket?.writable
    ) {
      return false;
    }
    instance.socket.write(serializeMpvCommand(command));
    return true;
  }

  private sendLoad(instance: OwnedMpvInstance): void {
    const input = this.input;
    if (!input) throw new Error("playback-input-missing");
    this.sendTracked(instance, "loadfile", this.generation, (id) =>
      createLoadfileCommand(input.streamUrl, id),
    );
    this.logger.write("mpv-load-requested", this.generation, {
      transport: input.transport,
    });
  }

  cyclePlaylist(direction: "next" | "previous"): number {
    const instance = this.active;
    if (!instance || !instance.socket?.writable || instance.processExited) {
      throw new Error("mpv-not-ready");
    }
    const generation = ++this.generation;
    this.sendTracked(instance, "playlist-step", generation, (id) =>
      createPlaylistStepCommand(direction, id),
    );
    this.logger.write("mpv-playlist-step-requested", generation, {
      direction,
    });
    return generation;
  }

  recordWindowGeometry(sample: WindowGeometrySample): void {
    this.logger.write("window-geometry-synchronized", this.generation, {
      displayId: sample.displayId,
      height: sample.height,
      reason: sample.reason,
      scaleFactor: sample.scaleFactor,
      state: sample.state,
      width: sample.width,
      x: sample.x,
      y: sample.y,
    });
    const instance = this.active;
    if (!instance?.socket?.writable || instance.processExited) return;
    this.sendTracked(instance, "geometry-width", this.generation, (id) =>
      createGetPropertyCommand("osd-width", id),
    );
    this.sendTracked(instance, "geometry-height", this.generation, (id) =>
      createGetPropertyCommand("osd-height", id),
    );
    this.requestWindowStackingSynchronization(instance);
  }

  recordGpuProcessLoss(reason: string): void {
    this.logger.write("electron-gpu-process-loss", this.generation, {
      reason: normalizedCode(reason),
    });
  }

  private async synchronizeWindowStacking(
    instance: OwnedMpvInstance,
  ): Promise<boolean> {
    const processId = instance.child.pid;
    if (!processId || instance.processExited || this.active !== instance) {
      return false;
    }
    return withTimeout(
      new Promise<boolean>((resolve) => {
        const helper = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            this.windowStackingHelperPath,
            "-ParentWindowId",
            this.nativeWindowId,
            "-MpvProcessId",
            String(processId),
          ],
          {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          },
        );
        helper.once("error", () => resolve(false));
        helper.once("exit", (code) => resolve(code === 0));
      }),
      3_000,
      false,
    );
  }

  private requestWindowStackingSynchronization(
    instance: OwnedMpvInstance,
  ): void {
    if (this.stackingSynchronizationInFlight || this.shuttingDown) return;
    this.stackingSynchronizationInFlight = true;
    void this.synchronizeWindowStacking(instance).then(
      (synchronized) => {
        this.stackingSynchronizationInFlight = false;
        this.logger.write("mpv-window-stacking-synchronized", this.generation, {
          instanceId: instance.id,
          synchronized,
        });
      },
      () => {
        this.stackingSynchronizationInFlight = false;
        this.logger.write("mpv-window-stacking-synchronized", this.generation, {
          instanceId: instance.id,
          synchronized: false,
        });
      },
    );
  }

  private startHeartbeat(instance: OwnedMpvInstance): void {
    instance.heartbeatInterval = setInterval(() => {
      if (
        this.active !== instance ||
        this.shuttingDown ||
        instance.processExited ||
        instance.heartbeatRequestId !== null
      ) {
        return;
      }
      try {
        const requestId = this.sendTracked(
          instance,
          "heartbeat",
          this.generation,
          (id) => createGetPropertyCommand("pid", id),
        );
        instance.heartbeatRequestId = requestId;
        instance.heartbeatTimeout = setTimeout(() => {
          if (instance.heartbeatRequestId === requestId) {
            this.logger.write("mpv-hang-detected", this.generation, {
              reason: "ipc-heartbeat-timeout",
            });
            void this.replaceUnresponsiveInstance(
              instance,
              "ipc-heartbeat-timeout",
            );
          }
        }, HEARTBEAT_TIMEOUT_MS);
      } catch {
        void this.replaceUnresponsiveInstance(instance, "ipc-unwritable");
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(instance: OwnedMpvInstance): void {
    if (instance.heartbeatInterval) clearInterval(instance.heartbeatInterval);
    if (instance.heartbeatTimeout) clearTimeout(instance.heartbeatTimeout);
    instance.heartbeatInterval = null;
    instance.heartbeatTimeout = null;
    instance.heartbeatRequestId = null;
  }

  private async replaceUnresponsiveInstance(
    instance: OwnedMpvInstance,
    reason: string,
  ): Promise<void> {
    if (
      this.active !== instance ||
      instance.intentionalStop ||
      this.shuttingDown
    ) {
      return;
    }
    instance.intentionalStop = true;
    this.logger.write("mpv-replacement-requested", this.generation, {
      reason: normalizedCode(reason),
    });
    await this.terminateInstance(instance, false);
    this.scheduleReplacement(reason);
  }

  private scheduleReplacement(reason: string): void {
    if (
      this.shuttingDown ||
      this.replacementTimer ||
      this.replacementAttempts >= 1
    ) {
      if (!this.shuttingDown && this.replacementAttempts >= 1) {
        this.logger.write("mpv-replacement-not-retried", this.generation, {
          reason: "slice3-single-attempt-limit",
        });
      }
      return;
    }
    this.replacementAttempts += 1;
    this.replacementStartedAt = performance.now();
    this.logger.write("mpv-replacement-scheduled", this.generation, {
      delayMs: REPLACEMENT_DELAY_MS,
      reason: normalizedCode(reason),
    });
    this.replacementTimer = setTimeout(() => {
      this.replacementTimer = null;
      void this.performReplacement();
    }, REPLACEMENT_DELAY_MS);
  }

  private async performReplacement(): Promise<void> {
    if (this.shuttingDown || !this.input) return;
    this.logger.write("mpv-replacement-started", this.generation, {
      elapsedSinceFailureMs:
        Math.round((performance.now() - this.replacementStartedAt) * 10) / 10,
    });
    try {
      const instance = await this.spawnAndConnect("replacement");
      this.sendLoad(instance);
      this.logger.write("mpv-replacement-connected", this.generation, {
        instanceId: instance.id,
      });
    } catch {
      this.logger.write("mpv-replacement-failed", this.generation, {
        reason: "replacement-startup-failure",
      });
    }
  }

  private removePendingCommands(instanceId: number): void {
    for (const [requestId, pending] of this.pendingCommands) {
      if (pending.instanceId === instanceId) {
        this.pendingCommands.delete(requestId);
      }
    }
  }

  private waitForEndFile(instance: OwnedMpvInstance): Promise<void> {
    return new Promise((resolve) => instance.endFileWaiters.push(resolve));
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    this.shuttingDown = true;
    this.replacementArmed = false;
    if (this.replacementTimer) clearTimeout(this.replacementTimer);
    this.replacementTimer = null;
    const instance = this.active;
    if (instance) {
      instance.intentionalStop = true;
      this.logger.write("mpv-shutdown-started", this.generation);
      await this.terminateInstance(instance, true);
    }

    await delay(100);
    let processAlive = false;
    let pipeReachable = false;
    for (const target of this.ownedTargets) {
      processAlive ||= isProcessAlive(target.processId);
      pipeReachable ||= await canConnectToPipe(target.pipeName);
    }
    this.logger.write("mpv-orphan-check", this.generation, {
      ownedProcessCount: this.ownedTargets.length,
      pipeReachable,
      processAlive,
    });
  }

  private async terminateInstance(
    instance: OwnedMpvInstance,
    graceful: boolean,
  ): Promise<void> {
    const processId = instance.child.pid;
    this.stopHeartbeat(instance);
    if (!processId || instance.processExited) return;

    if (graceful && instance.socket?.writable) {
      const endFile = this.waitForEndFile(instance);
      this.send(instance, createControlCommand("stop", ++this.requestSequence));
      await withTimeout(endFile, 750, undefined);
      this.send(instance, createControlCommand("quit", ++this.requestSequence));
    }

    let exited = graceful
      ? await withTimeout(
          instance.exitPromise.then(() => true),
          2_500,
          false,
        )
      : false;
    if (!exited) {
      this.logger.write("mpv-forced-termination", this.generation, {
        stage: "child-kill",
      });
      instance.child.kill();
      exited = await withTimeout(
        instance.exitPromise.then(() => true),
        1_500,
        false,
      );
    }
    if (!exited && isProcessAlive(processId)) {
      this.logger.write("mpv-forced-termination", this.generation, {
        stage: "taskkill-tree",
      });
      await forceKillTree(processId);
      await withTimeout(instance.exitPromise, 1_500, undefined);
    }
    instance.socket?.destroy();
    instance.socket = null;
  }
}
