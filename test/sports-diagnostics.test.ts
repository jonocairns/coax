import { describe, expect, it } from "vitest";
import { summarizeSportsDiagnostics } from "../src/main/mpv/sports-diagnostics";

describe("sports cadence, drop, repeat, and A/V drift diagnostics", () => {
  it("summarizes field-rate cadence and counter deltas after warm-up", () => {
    const summary = summarizeSportsDiagnostics(
      [
        { elapsedMs: 30_000, property: "estimated-vf-fps", value: 49.9 },
        { elapsedMs: 32_000, property: "estimated-vf-fps", value: 50.1 },
        { elapsedMs: 30_000, property: "frame-drop-count", value: 4 },
        { elapsedMs: 60_000, property: "frame-drop-count", value: 4 },
        {
          elapsedMs: 30_000,
          property: "decoder-frame-drop-count",
          value: 0,
        },
        {
          elapsedMs: 60_000,
          property: "decoder-frame-drop-count",
          value: 0,
        },
        { elapsedMs: 30_000, property: "mistimed-frame-count", value: 1 },
        { elapsedMs: 60_000, property: "mistimed-frame-count", value: 2 },
        { elapsedMs: 30_000, property: "vo-delayed-frame-count", value: 0 },
        { elapsedMs: 60_000, property: "vo-delayed-frame-count", value: 0 },
        { elapsedMs: 30_000, property: "avsync", value: 0.004 },
        { elapsedMs: 60_000, property: "avsync", value: 0.005 },
      ],
      [
        {
          elapsedMs: 30_000,
          interlaced: true,
          repeat: false,
          tff: true,
        },
        {
          elapsedMs: 32_000,
          interlaced: false,
          repeat: true,
          tff: false,
        },
      ],
      50,
    );

    expect(summary.cadence).toMatchObject({
      medianFps: 50,
      sampleCount: 2,
      withinHalfFps: true,
    });
    expect(summary.counterDeltas).toEqual({
      decoderDrops: 0,
      delayedFrames: 0,
      mistimedFrames: 1,
      voDrops: 0,
    });
    expect(summary.frameInfo).toMatchObject({
      interlacedSamples: 1,
      repeatSamples: 1,
      tffSamples: 1,
    });
    expect(summary.avsync.maxAbsolute).toBe(0.005);
    expect(summary.avsync.slopeSecondsPerHour).toBeCloseTo(0.12);
  });
});
