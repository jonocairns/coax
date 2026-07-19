import { describe, expect, it } from "vitest";
import {
  buildMpvArguments,
  createLoadfileCommand,
  createMpvPipeName,
  createObservePropertyCommand,
  createPlaylistStepCommand,
  serializeMpvCommand,
} from "../src/main/mpv/commands";

describe("mpv command construction", () => {
  it("uses an unpredictable per-process pipe without putting a stream in arguments", () => {
    const firstPipe = createMpvPipeName(1234);
    const secondPipe = createMpvPipeName(1234);
    const streamUrl = "https://user:password@example.invalid/live?id=secret";
    const arguments_ = buildMpvArguments(firstPipe);

    expect(firstPipe).toMatch(/^\\\\\.\\pipe\\coax-mpv-1234-[a-f0-9]{48}$/);
    expect(secondPipe).not.toBe(firstPipe);
    expect(arguments_.some((argument) => argument.includes(streamUrl))).toBe(
      false,
    );
    expect(arguments_).toContain("--no-config");
    expect(arguments_).toContain(`--input-ipc-server=${firstPipe}`);
  });

  it("places the private stream only in a newline-delimited loadfile IPC command", () => {
    const streamUrl = "https://example.invalid/private/live.m3u8?token=secret";
    const serialized = serializeMpvCommand(createLoadfileCommand(streamUrl, 7));

    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual({
      command: ["loadfile", streamUrl, "replace"],
      request_id: 7,
    });
  });

  it("constructs only the fixed cache observation command", () => {
    expect(createObservePropertyCommand("paused-for-cache", 99)).toEqual({
      command: ["observe_property", 99, "paused-for-cache"],
      request_id: 99,
    });
  });

  it("constructs fixed internal-playlist navigation commands", () => {
    expect(createPlaylistStepCommand("next", 101)).toEqual({
      command: ["playlist-next", "force"],
      request_id: 101,
    });
    expect(createPlaylistStepCommand("previous", 102)).toEqual({
      command: ["playlist-prev", "force"],
      request_id: 102,
    });
  });
});
