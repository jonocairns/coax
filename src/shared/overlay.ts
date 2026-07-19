export type OverlayAction = "hide" | "show" | "toggle";

export type OverlayFeedbackPhase =
  "playing" | "ready" | "recovering" | "unavailable" | "zapping";

export interface OverlayState {
  feedback: string;
  focused: boolean;
  generation: number;
  next: string;
  now: string;
  phase: OverlayFeedbackPhase;
  visible: boolean;
}

export type OverlayStateEvent =
  | { focus: boolean; type: "show" }
  | { type: "hide" }
  | {
      direction: "next" | "previous";
      generation: number;
      type: "zap";
    }
  | {
      generation: number;
      type: "playing";
    }
  | {
      feedback: string;
      generation: number;
      type: "recovering";
    }
  | { type: "unavailable" };

export const INITIAL_OVERLAY_STATE: Readonly<OverlayState> = Object.freeze({
  feedback: "Playback controls ready",
  focused: false,
  generation: 0,
  next: "Next playlist entry",
  now: "Current playlist entry",
  phase: "ready",
  visible: false,
});

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
      return { ...state, focused: event.focus, visible: true };
    case "hide":
      return { ...state, focused: false, visible: false };
    case "zap":
      return {
        ...state,
        feedback: `${event.direction === "next" ? "Next" : "Previous"} channel requested`,
        generation: event.generation,
        phase: "zapping",
        visible: true,
      };
    case "playing":
      return {
        ...state,
        feedback: "Playback resumed",
        generation: event.generation,
        phase: "playing",
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
