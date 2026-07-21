import type { StreamStatsSnapshot } from "../../shared/stream-stats";
import type { MpvDiagnosticProperty } from "./commands";

export function applyStreamPerformanceSample(
  snapshot: StreamStatsSnapshot,
  property: MpvDiagnosticProperty,
  value: number,
  generation: number,
  updatedAt: number,
): StreamStatsSnapshot {
  const update: Partial<StreamStatsSnapshot> = {};
  if (property === "avsync") update.avSyncSeconds = value;
  else if (property === "container-fps") update.containerFps = value;
  else if (property === "decoder-frame-drop-count")
    update.decoderDroppedFrames = value;
  else if (property === "demuxer-cache-duration") update.bufferSeconds = value;
  else if (property === "display-fps") update.displayFps = value;
  else if (property === "estimated-display-fps" && snapshot.displayFps === null)
    update.displayFps = value;
  else if (property === "estimated-vf-fps") update.estimatedVideoFps = value;
  else if (property === "frame-drop-count") update.outputDroppedFrames = value;
  else if (property === "mistimed-frame-count") update.mistimedFrames = value;
  else if (property === "vo-delayed-frame-count")
    update.voDelayedFrames = value;
  else return snapshot;
  return {
    ...snapshot,
    ...update,
    available: true,
    generation,
    updatedAt,
  };
}
