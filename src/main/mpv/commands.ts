import { randomBytes } from "node:crypto";

export interface MpvCommand {
  command: readonly unknown[];
  request_id: number;
}

export function createMpvPipeName(processId: number): string {
  const nonce = randomBytes(24).toString("hex");
  return `\\\\.\\pipe\\coax-mpv-${processId}-${nonce}`;
}

export function buildMpvArguments(pipeName: string): readonly string[] {
  if (!/^\\\\\.\\pipe\\coax-mpv-\d+-[a-f0-9]{48}$/.test(pipeName)) {
    throw new Error("invalid-mpv-pipe-name");
  }

  return [
    "--no-config",
    "--idle=yes",
    "--force-window=yes",
    "--keep-open=no",
    "--terminal=no",
    "--input-default-bindings=no",
    "--input-cursor=no",
    "--osc=no",
    "--osd-level=0",
    `--input-ipc-server=${pipeName}`,
  ];
}

export function createLoadfileCommand(
  streamUrl: string,
  generation: number,
): MpvCommand {
  return {
    command: ["loadfile", streamUrl, "replace"],
    request_id: generation,
  };
}

export function createControlCommand(
  name: "stop" | "quit",
  requestId: number,
): MpvCommand {
  return { command: [name], request_id: requestId };
}

export function createObservePropertyCommand(
  property: "paused-for-cache",
  requestId: number,
): MpvCommand {
  return {
    command: ["observe_property", requestId, property],
    request_id: requestId,
  };
}

export function createPlaylistStepCommand(
  direction: "next" | "previous",
  requestId: number,
): MpvCommand {
  return {
    command: [
      direction === "next" ? "playlist-next" : "playlist-prev",
      "force",
    ],
    request_id: requestId,
  };
}

export function serializeMpvCommand(command: MpvCommand): string {
  return `${JSON.stringify(command)}\n`;
}
