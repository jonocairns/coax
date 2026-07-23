export type OverlayAction =
  "browse" | "fullscreen" | "hide" | "show" | "toggle" | "watch";

export type OverlayView = "browse" | "controls";

export type OverlayFeedbackPhase =
  "playing" | "ready" | "recovering" | "unavailable" | "zapping";

export interface OverlayState {
  channelId: string | null;
  fading: boolean;
  feedback: string;
  focused: boolean;
  generation: number;
  muted: boolean;
  now: string;
  phase: OverlayFeedbackPhase;
  view: OverlayView;
  visible: boolean;
  volume: number;
}

export type OverlayStateEvent =
  | { focus: boolean; type: "show"; view?: OverlayView }
  | { type: "hide"; view?: OverlayView }
  | { type: "fade" }
  | { muted: boolean; type: "audio"; volume: number }
  | {
      direction: "next" | "previous";
      generation: number;
      type: "zap";
    }
  | {
      channelId: string;
      channelName: string;
      generation: number;
      type: "channel-zap";
    }
  | {
      generation: number;
      type: "playing";
    }
  | { generation: number; type: "stopped" }
  | {
      feedback: string;
      generation: number;
      type: "recovering";
    }
  | { type: "unavailable" };

export const INITIAL_OVERLAY_STATE: Readonly<OverlayState> = Object.freeze({
  channelId: null,
  fading: false,
  feedback: "Playback controls ready",
  focused: false,
  generation: 0,
  muted: false,
  now: "Current playlist entry",
  phase: "ready",
  view: "browse",
  visible: false,
  volume: 100,
});

export function shouldRevealPlaybackControlsForPointer(
  state: Pick<OverlayState, "fading" | "view" | "visible">,
): boolean {
  return state.view === "controls" && (!state.visible || state.fading);
}

export function reduceOverlayState(
  state: Readonly<OverlayState>,
  event: OverlayStateEvent,
): OverlayState {
  if (
    "generation" in event &&
    (!Number.isSafeInteger(event.generation) ||
      event.generation < state.generation)
  ) {
    return { ...state };
  }

  switch (event.type) {
    case "show":
      return {
        ...state,
        fading: false,
        focused: event.focus,
        view: event.view ?? state.view,
        visible: true,
      };
    case "hide":
      return {
        ...state,
        fading: false,
        focused: false,
        view: event.view ?? state.view,
        visible: false,
      };
    case "fade":
      return state.visible && state.view === "controls"
        ? { ...state, fading: true }
        : { ...state };
    case "audio":
      return {
        ...state,
        muted: event.muted,
        volume: Math.min(100, Math.max(0, event.volume)),
      };
    case "zap":
      return {
        ...state,
        feedback: `${event.direction === "next" ? "Next" : "Previous"} channel requested`,
        generation: event.generation,
        phase: "zapping",
        visible: true,
      };
    case "channel-zap":
      return {
        ...state,
        channelId: event.channelId,
        feedback: "Channel requested",
        generation: event.generation,
        now: event.channelName,
        phase: "zapping",
      };
    case "playing":
      return {
        ...state,
        feedback: "Playback resumed",
        generation: event.generation,
        phase: "playing",
      };
    case "stopped":
      return {
        ...state,
        channelId: null,
        feedback: "Playback stopped",
        generation: event.generation,
        now: "Choose a channel",
        phase: "ready",
      };
    case "recovering":
      return {
        ...state,
        feedback: event.feedback,
        generation: event.generation,
        phase: "recovering",
        visible: true,
      };
    case "unavailable":
      return {
        ...state,
        feedback: "Playback unavailable",
        phase: "unavailable",
      };
  }
}
