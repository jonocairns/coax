export type GeometryReason =
  | "enter-full-screen"
  | "gpu-process-restored"
  | "leave-full-screen"
  | "maximize"
  | "move"
  | "ready"
  | "resize"
  | "restore"
  | "unmaximize";

export type WindowPresentationState =
  "fullscreen" | "maximized" | "minimized" | "normal";

export interface WindowStateFlags {
  fullscreen: boolean;
  maximized: boolean;
  minimized: boolean;
}

export interface GeometrySynchronizationDecision {
  record: boolean;
  settleDelayMs: number;
}

export function presentationState(
  flags: WindowStateFlags,
): WindowPresentationState {
  if (flags.minimized) return "minimized";
  if (flags.fullscreen) return "fullscreen";
  if (flags.maximized) return "maximized";
  return "normal";
}

export function decideGeometrySynchronization(
  reason: GeometryReason,
  flags: WindowStateFlags,
): GeometrySynchronizationDecision {
  if (flags.minimized) return { record: false, settleDelayMs: 0 };
  if (reason === "move" || reason === "resize") {
    return { record: true, settleDelayMs: 80 };
  }
  if (reason === "ready") return { record: true, settleDelayMs: 0 };
  return { record: true, settleDelayMs: 250 };
}
