import { describe, expect, it } from "vitest";
import {
  parseLocalPlaybackInput,
  parseSlice8HarnessInput,
} from "../src/main/mpv/playback-input";

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

describe("Slice 8 harness playback input", () => {
  it("accepts only the stable clean fixture paths on a private HTTP host", () => {
    expect(
      parseSlice8HarnessInput(
        "http://172.20.1.1:48180/v1/stream/ts",
        "clean-ts",
      ),
    ).toEqual({
      channelId: "harness:clean-ts",
      streamUrl: "http://172.20.1.1:48180/v1/stream/ts",
      transport: "mpeg-ts",
    });
    expect(
      parseSlice8HarnessInput(
        "http://127.0.0.1:48180/v1/stream/hls-aes/index.m3u8",
        "clean-aes128-hls",
      )?.transport,
    ).toBe("hls");
  });

  it("rejects public, authenticated, queried, or mismatched harness URLs", () => {
    expect(() =>
      parseSlice8HarnessInput(
        "https://example.invalid/v1/stream/ts",
        "clean-ts",
      ),
    ).toThrow("invalid-slice8-harness-url");
    expect(() =>
      parseSlice8HarnessInput(
        "http://user:secret@127.0.0.1:48180/v1/stream/ts",
        "clean-ts",
      ),
    ).toThrow("invalid-slice8-harness-url");
    expect(() =>
      parseSlice8HarnessInput(
        "http://127.0.0.1:48180/v1/stream/hls/index.m3u8?fault=drop",
        "clean-hls",
      ),
    ).toThrow("invalid-slice8-harness-url");
    expect(() =>
      parseSlice8HarnessInput(
        "http://127.0.0.1:48180/v1/stream/ts",
        "clean-hls",
      ),
    ).toThrow("invalid-slice8-harness-url");
  });
});
