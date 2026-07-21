import { describe, expect, it } from "vitest";
import { applyStreamPerformanceSample } from "../src/main/mpv/stream-stats";
import { INITIAL_STREAM_STATS_SNAPSHOT } from "../src/shared/stream-stats";

describe("on-demand stream statistics", () => {
  it("maps continuity and timing samples without claiming VSR confirmation", () => {
    const initial = { ...INITIAL_STREAM_STATS_SNAPSHOT };
    const withDrops = applyStreamPerformanceSample(
      initial,
      "frame-drop-count",
      3,
      7,
      1_000,
    );
    const withSync = applyStreamPerformanceSample(
      withDrops,
      "avsync",
      0.012,
      7,
      2_000,
    );

    expect(withSync).toMatchObject({
      available: true,
      avSyncSeconds: 0.012,
      generation: 7,
      outputDroppedFrames: 3,
      updatedAt: 2_000,
      vsrConfirmed: false,
    });
  });

  it("keeps a measured display rate over a later estimate", () => {
    const measured = applyStreamPerformanceSample(
      { ...INITIAL_STREAM_STATS_SNAPSHOT },
      "display-fps",
      59.94,
      1,
      1_000,
    );
    const estimated = applyStreamPerformanceSample(
      measured,
      "estimated-display-fps",
      60,
      1,
      2_000,
    );

    expect(estimated).toBe(measured);
    expect(estimated.displayFps).toBe(59.94);
  });
});
