import { describe, expect, it } from "vitest";
import {
  buildMpvArguments,
  createGetPropertyCommand,
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
    const arguments_ = buildMpvArguments(firstPipe, "4294967297");

    expect(firstPipe).toMatch(/^\\\\\.\\pipe\\coax-mpv-1234-[a-f0-9]{48}$/);
    expect(secondPipe).not.toBe(firstPipe);
    expect(arguments_.some((argument) => argument.includes(streamUrl))).toBe(
      false,
    );
    expect(arguments_).toContain("--no-config");
    expect(arguments_).toContain("--wid=4294967297");
    expect(arguments_).toContain(`--input-ipc-server=${firstPipe}`);
  });

  it("constructs only fixed diagnostic property reads", () => {
    expect(createGetPropertyCommand("playlist-pos", 103)).toEqual({
      command: ["get_property", "playlist-pos"],
      request_id: 103,
    });
  });

  it("places the private stream only in a newline-delimited loadfile IPC command", () => {
    const streamUrl = "https://example.invalid/private/live.m3u8?token=secret";
    const serialized = serializeMpvCommand(
      createLoadfileCommand({ streamUrl, transport: "https" }, 7),
    );

    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual({
      command: ["loadfile", streamUrl, "replace"],
      request_id: 7,
    });
  });

  it("scopes provider headers and cookies to per-file options, never process arguments", () => {
    const command = createLoadfileCommand(
      {
        channelId: "xch_111111111111111111111111",
        http: {
          cookie: "session=fixture",
          headers: { "X-Fixture": "one,two" },
          referer: "https://referer.invalid/",
          userAgent: "Fixture agent",
        },
        streamUrl: "https://provider.invalid/live/fixture.ts",
        transport: "mpeg-ts",
      },
      8,
    );
    const options = command.command[4] as Record<string, string>;

    expect(command.command.slice(0, 4)).toEqual([
      "loadfile",
      "https://provider.invalid/live/fixture.ts",
      "replace",
      -1,
    ]);
    expect(options).toMatchObject({
      "http-header-fields": "X-Fixture: one\\,two,Cookie: session=fixture",
      referrer: "https://referer.invalid/",
      "user-agent": "Fixture agent",
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
