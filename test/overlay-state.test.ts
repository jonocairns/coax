import { describe, expect, it } from "vitest";
import {
  INITIAL_OVERLAY_STATE,
  playbackControlsOwnController,
  reduceOverlayState,
  shouldRevealPlaybackControlsForPointer,
} from "../src/shared/overlay";

describe("playback overlay state", () => {
  it("does not replace the channel browser after pointer activity selects a channel", () => {
    expect(
      shouldRevealPlaybackControlsForPointer({
        fading: false,
        view: "browse",
        visible: false,
      }),
    ).toBe(false);
  });

  it("reveals hidden playback controls while watching video", () => {
    expect(
      shouldRevealPlaybackControlsForPointer({
        fading: false,
        view: "controls",
        visible: false,
      }),
    ).toBe(true);
  });

  it("keeps the transparent overlay hidden while the main shell is browsing", () => {
    const zapping = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      channelId: "xch_111111111111111111111111",
      channelName: "Fixture Sports",
      generation: 1,
      type: "channel-zap",
    });

    expect(zapping).toMatchObject({
      phase: "zapping",
      view: "browse",
      visible: false,
    });
  });

  it("uses immediate generation-scoped zap feedback", () => {
    const zapping = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      direction: "next",
      generation: 7,
      type: "zap",
    });

    expect(zapping).toMatchObject({
      feedback: "Next channel requested",
      generation: 7,
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

  it("preserves browsing mode and audio state across playback feedback", () => {
    const browsing = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      focus: true,
      type: "show",
      view: "browse",
    });
    const withAudio = reduceOverlayState(browsing, {
      muted: true,
      type: "audio",
      volume: 68,
    });
    const zapping = reduceOverlayState(withAudio, {
      channelId: "xch_111111111111111111111111",
      channelName: "Fixture Sports",
      generation: 5,
      type: "channel-zap",
    });

    expect(zapping).toMatchObject({
      channelId: "xch_111111111111111111111111",
      focused: true,
      muted: true,
      now: "Fixture Sports",
      view: "browse",
      visible: true,
      volume: 68,
    });
  });

  it("can leave browsing hidden while preparing player controls", () => {
    const browsing = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      focus: true,
      type: "show",
      view: "browse",
    });

    expect(
      reduceOverlayState(browsing, { type: "hide", view: "controls" }),
    ).toMatchObject({ focused: false, view: "controls", visible: false });
  });

  it("fades player controls without fading the channel browser", () => {
    const controls = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      focus: false,
      type: "show",
      view: "controls",
    });
    const browsing = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      focus: true,
      type: "show",
      view: "browse",
    });

    expect(reduceOverlayState(controls, { type: "fade" }).fading).toBe(true);
    expect(reduceOverlayState(browsing, { type: "fade" }).fading).toBe(false);
  });

  it("clears the active channel when playback stops", () => {
    const playing = reduceOverlayState(INITIAL_OVERLAY_STATE, {
      channelId: "xch_111111111111111111111111",
      channelName: "Fixture Sports",
      generation: 4,
      type: "channel-zap",
    });

    expect(
      reduceOverlayState(playing, { generation: 5, type: "stopped" }),
    ).toMatchObject({
      channelId: null,
      feedback: "Playback stopped",
      generation: 5,
      now: "Choose a channel",
      phase: "ready",
    });
  });
});

describe("controller ownership", () => {
  // The overlay owns controller input only while its controls are visible;
  // the main shell window owns every other state. The two are exact
  // complements, so exactly one window handles each physical press.
  it("gives ownership to the overlay while playback controls are visible", () => {
    expect(
      playbackControlsOwnController({ view: "controls", visible: true }),
    ).toBe(true);
  });

  it("leaves ownership with the shell while watching with controls hidden", () => {
    expect(
      playbackControlsOwnController({ view: "controls", visible: false }),
    ).toBe(false);
  });

  it("leaves ownership with the shell in the browse view", () => {
    expect(
      playbackControlsOwnController({ view: "browse", visible: false }),
    ).toBe(false);
    // A visible browse overlay still is not the controls surface.
    expect(
      playbackControlsOwnController({ view: "browse", visible: true }),
    ).toBe(false);
  });
});
