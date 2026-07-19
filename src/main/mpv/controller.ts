import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import {
  buildMpvArguments,
  createControlCommand,
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
import { StructuredPlaybackLogger } from "./structured-log";

const REQUIRED_MPV_EVENTS = new Set([
  "start-file",
  "file-loaded",
  "playback-restart",
  "video-reconfig",
  "audio-reconfig",
  "end-file",
]);

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
  private readonly pipeName = createMpvPipeName(process.pid);
  private child: ChildProcess | null = null;
  private socket: Socket | null = null;
  private processExited = false;
  private exitPromise: Promise<void> = Promise.resolve();
  private resolveExit: (() => void) | null = null;
  private endFileWaiters: Array<() => void> = [];
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    private readonly runtime: VerifiedMpvRuntime,
    private readonly logger: StructuredPlaybackLogger,
  ) {}

  async start(input: LocalPlaybackInput): Promise<void> {
    const arguments_ = buildMpvArguments(this.pipeName);
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    const child = spawn(this.runtime.executablePath, arguments_, {
      detached: false,
      shell: false,
      stdio: "ignore",
      windowsHide: false,
    });
    this.child = child;
    this.logger.write("mpv-spawned", this.generation, {
      processId: child.pid ?? null,
      transport: input.transport,
      mpvCommit: this.runtime.manifest.source.mpvCommit,
      ffmpegCommit: this.runtime.manifest.source.ffmpegCommit,
    });

    const markExited = (): void => {
      if (this.processExited) return;
      this.processExited = true;
      this.logger.write("mpv-process-exit", this.generation, {
        exitCode: child.exitCode,
        signal: normalizedCode(child.signalCode),
      });
      this.resolveExit?.();
      this.resolveExit = null;
    };
    child.once("exit", markExited);
    child.once("error", () => {
      this.logger.write("mpv-process-error", this.generation, {
        reason: "spawn-error",
      });
      markExited();
    });

    try {
      this.socket = await connectToPipe(
        this.pipeName,
        () => this.processExited,
      );
      this.listenToIpc(this.socket);
      this.logger.write("mpv-ipc-connected", this.generation);
      this.send(createObservePropertyCommand("paused-for-cache", 2_000_000));
      this.load(input);
    } catch (error) {
      await this.shutdown();
      throw error;
    }
  }

  private listenToIpc(socket: Socket): void {
    const parser = new JsonLineParser();
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      for (const result of parser.push(chunk)) {
        if (!result.ok) {
          this.logger.write("mpv-ipc-parse-error", this.generation, {
            reason: result.reason,
          });
          continue;
        }
        this.handleIpcMessage(result.value);
      }
    });
    socket.on("error", () => {
      if (!this.processExited) {
        this.logger.write("mpv-ipc-error", this.generation, {
          reason: "socket-error",
        });
      }
    });
    socket.on("close", () => {
      this.logger.write("mpv-ipc-closed", this.generation);
    });
  }

  private handleIpcMessage(message: unknown): void {
    if (!isRecord(message)) return;
    if (
      message.event === "property-change" &&
      message.name === "paused-for-cache" &&
      typeof message.data === "boolean"
    ) {
      this.logger.write("mpv-cache-state", this.generation, {
        pausedForCache: message.data,
      });
      return;
    }
    if (
      typeof message.event === "string" &&
      REQUIRED_MPV_EVENTS.has(message.event)
    ) {
      const details: Record<string, string> = { mpvEvent: message.event };
      if (message.event === "end-file") {
        details.reason = normalizedCode(message.reason);
        for (const resolve of this.endFileWaiters.splice(0)) resolve();
      }
      this.logger.write("mpv-event", this.generation, details);
      return;
    }

    if (typeof message.request_id === "number") {
      this.logger.write("mpv-command-result", this.generation, {
        command:
          message.request_id === this.generation
            ? "loadfile"
            : message.request_id >= 1_000_000 && message.request_id < 2_000_000
              ? "playlist-step"
              : message.request_id === 2_000_000
                ? "observe-paused-for-cache"
                : "lifecycle",
        result: normalizedCode(message.error),
      });
    }
  }

  private send(command: MpvCommand): boolean {
    if (!this.socket?.writable) return false;
    this.socket.write(serializeMpvCommand(command));
    return true;
  }

  private load(input: LocalPlaybackInput): void {
    if (!this.socket?.writable || this.processExited) {
      throw new Error("mpv-not-ready");
    }
    this.generation += 1;
    this.send(createLoadfileCommand(input.streamUrl, this.generation));
    this.logger.write("mpv-load-requested", this.generation, {
      transport: input.transport,
    });
  }

  cyclePlaylist(direction: "next" | "previous"): void {
    if (!this.socket?.writable || this.processExited) {
      throw new Error("mpv-not-ready");
    }
    this.generation += 1;
    this.send(
      createPlaylistStepCommand(direction, 1_000_000 + this.generation),
    );
    this.logger.write("mpv-playlist-step-requested", this.generation, {
      direction,
    });
  }

  private waitForEndFile(): Promise<void> {
    return new Promise((resolve) => this.endFileWaiters.push(resolve));
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    const child = this.child;
    const processId = child?.pid;
    if (!child || !processId) return;

    this.logger.write("mpv-shutdown-started", this.generation);
    if (!this.processExited && this.socket?.writable) {
      const endFile = this.waitForEndFile();
      this.send(createControlCommand("stop", this.generation + 3_000_000));
      await withTimeout(endFile, 750, undefined);
      this.send(createControlCommand("quit", this.generation + 3_000_001));
    }

    let exited = await withTimeout(this.exitPromise, 2_500, null).then(
      (value) => value !== null,
    );
    if (!exited) {
      this.logger.write("mpv-forced-termination", this.generation, {
        stage: "child-kill",
      });
      child.kill();
      exited = await withTimeout(this.exitPromise, 1_500, null).then(
        (value) => value !== null,
      );
    }
    if (!exited && isProcessAlive(processId)) {
      this.logger.write("mpv-forced-termination", this.generation, {
        stage: "taskkill-tree",
      });
      await forceKillTree(processId);
      await withTimeout(this.exitPromise, 1_500, undefined);
    }

    this.socket?.destroy();
    this.socket = null;
    await delay(100);
    this.logger.write("mpv-orphan-check", this.generation, {
      processAlive: isProcessAlive(processId),
      pipeReachable: await canConnectToPipe(this.pipeName),
    });
  }
}
