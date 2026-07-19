import { describe, expect, it } from "vitest";
import { parseLocalPlaybackInput } from "../src/main/mpv/playback-input";

describe("ignored local playback input", () => {
  it("accepts one HTTP(S) playlist URL", () => {
    expect(
      parseLocalPlaybackInput(
        JSON.stringify({ streamUrl: "https://example.invalid/live.m3u8" }),
      ),
    ).toEqual({
      streamUrl: "https://example.invalid/live.m3u8",
      transport: "https",
    });
  });

  it("rejects file input and provider-style extra fields", () => {
    expect(() =>
      parseLocalPlaybackInput(
        JSON.stringify({ streamUrl: "file:///private.ts" }),
      ),
    ).toThrow("unsupported-playback-input-protocol");
    expect(() =>
      parseLocalPlaybackInput(
        JSON.stringify({
          streamUrl: "https://example.invalid/live",
          password: "do-not-support-provider-input-in-slice-2",
        }),
      ),
    ).toThrow("invalid-playback-input-shape");
  });
});
