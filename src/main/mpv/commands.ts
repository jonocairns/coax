import { randomBytes } from "node:crypto";
import type { MpvPlaybackInput } from "./playback-input";

export interface MpvCommand {
  command: readonly unknown[];
  request_id: number;
}

export function createMpvPipeName(processId: number): string {
  const nonce = randomBytes(24).toString("hex");
  return `\\\\.\\pipe\\coax-mpv-${processId}-${nonce}`;
}

export function buildMpvArguments(
  pipeName: string,
  nativeWindowId: string,
): readonly string[] {
  if (!/^\\\\\.\\pipe\\coax-mpv-\d+-[a-f0-9]{48}$/.test(pipeName)) {
    throw new Error("invalid-mpv-pipe-name");
  }
  if (!/^[1-9]\d{0,19}$/.test(nativeWindowId)) {
    throw new Error("invalid-native-window-id");
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
    `--wid=${nativeWindowId}`,
    `--input-ipc-server=${pipeName}`,
  ];
}

export function createLoadfileCommand(
  input: MpvPlaybackInput,
  generation: number,
): MpvCommand {
  const options: Record<string, string> = {};
  if (input.http?.userAgent) options["user-agent"] = input.http.userAgent;
  if (input.http?.referer) options.referrer = input.http.referer;
  const fields = Object.entries(input.http?.headers ?? {}).map(
    ([name, value]) => `${name}: ${value}`,
  );
  if (input.http?.cookie) fields.push(`Cookie: ${input.http.cookie}`);
  if (fields.length > 0) {
    options["http-header-fields"] = fields
      .map((field) => field.replace(/\\/g, "\\\\").replace(/,/g, "\\,"))
      .join(",");
  }
  return {
    command:
      Object.keys(options).length === 0
        ? ["loadfile", input.streamUrl, "replace"]
        : ["loadfile", input.streamUrl, "replace", -1, options],
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

export function createGetPropertyCommand(
  property: "osd-height" | "osd-width" | "pid" | "playlist-pos",
  requestId: number,
): MpvCommand {
  return {
    command: ["get_property", property],
    request_id: requestId,
  };
}

export function serializeMpvCommand(command: MpvCommand): string {
  return `${JSON.stringify(command)}\n`;
}
