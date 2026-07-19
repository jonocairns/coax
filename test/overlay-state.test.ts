import { describe, expect, it } from "vitest";
import {
  INITIAL_OVERLAY_STATE,
  reduceOverlayState,
} from "../src/shared/overlay";

describe("playback overlay state", () => {
  it("uses fixed placeholders and immediate generation-scoped zap feedback", () => {
    const zapping = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      direction: "next",
      generation: 7,
      type: "zap",
    });

    expect(zapping).toMatchObject({
      feedback: "Next channel requested",
      generation: 7,
      next: "Next playlist entry",
      now: "Current playlist entry",
      phase: "zapping",
      visible: true,
    });
    expect(
      reduceOverlayState(zapping, { generation: 6, type: "playing" }),
    ).toEqual(zapping);
  });

  it("shows recovery feedback and explicitly releases focus when hidden", () => {
    const recovering = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      feedback: "Reconnecting playback",
      generation: 3,
      type: "recovering",
    });
    const focused = reduceOverlayState(recovering, {
      focus: true,
      type: "show",
    });

    expect(focused.focused).toBe(true);
    expect(focused.phase).toBe("recovering");
    expect(reduceOverlayState(focused, { type: "hide" })).toMatchObject({
      focused: false,
      visible: false,
    });
  });

  it("does not let playback feedback steal or release an open overlay's focus", () => {
    const focused = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      focus: true,
      type: "show",
    });
    const zapping = reduceOverlayState(focused, {
      direction: "previous",
      generation: 4,
      type: "zap",
    });
    const recovering = reduceOverlayState(zapping, {
      feedback: "Buffering playback",
      generation: 4,
      type: "recovering",
    });

    expect(zapping.focused).toBe(true);
    expect(recovering.focused).toBe(true);
  });
});
