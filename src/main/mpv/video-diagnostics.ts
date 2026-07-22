import type { AdapterSelection, MpvPlaybackProfile } from "./hardware-profile";
import type { DeinterlacePolicy } from "./sports-profile";
import type { StructuredLogValue } from "./structured-log";
import type {
  VideoFilterGraphDecision,
  VideoFilterGraphInspection,
} from "./video-filter-graph";
import type { VideoScaleDecision } from "./video-scaling";

export interface VideoDiagnosticValues {
  currentGpuContext: string | null;
  currentVo: string | null;
  decoder: string | null;
  filterGraph: VideoFilterGraphInspection;
  frameInterlaced: boolean | null;
  frameRepeat: boolean | null;
  frameTff: boolean | null;
  hwdecCurrent: string | null;
  hwdecInterop: string | null;
  outputHeight: number | null;
  outputWidth: number | null;
  reason: string;
  sourceHeight: number | null;
  sourceWidth: number | null;
  viewportHeight: number | null;
  viewportWidth: number | null;
}

export function createVideoDiagnosticDetails(
  values: VideoDiagnosticValues,
  profile: MpvPlaybackProfile,
  adapterSelection: AdapterSelection,
  scaling: VideoScaleDecision,
  deinterlace: DeinterlacePolicy,
  graph: VideoFilterGraphDecision,
): Readonly<Record<string, StructuredLogValue>> {
  return {
    adapter: adapterSelection.adapter.description,
    adapterSelectionReason: adapterSelection.reason,
    currentGpuContext: values.currentGpuContext,
    currentVo: values.currentVo,
    decoder: values.decoder,
    deinterlaceFilterAttached: values.filterGraph.deinterlaceFilterAttached,
    deinterlaceHardwareFailureForced: deinterlace.forceHardwareFailure,
    deinterlaceInterlacedOnly: graph.interlacedOnly,
    deinterlaceMode: deinterlace.mode,
    deinterlacePath: graph.path,
    deinterlaceRequested: graph.deinterlaceRequested,
    duplicateOwnedFilterCount: values.filterGraph.duplicateOwnedFilterCount,
    fallbackScaler: scaling.fallbackScaler,
    fieldOrder: graph.fieldOrder,
    fieldOrderOverride: graph.fieldOrder === "auto" ? "none" : graph.fieldOrder,
    frameInterlaced: values.frameInterlaced,
    frameRepeat: values.frameRepeat,
    frameTff: values.frameTff,
    hwdecCurrent: values.hwdecCurrent,
    hwdecInterop: values.hwdecInterop,
    outputHeight: values.outputHeight,
    outputWidth: values.outputWidth,
    profile: profile.name,
    reason: values.reason,
    renderPath:
      values.currentVo && values.currentGpuContext
        ? `${values.currentVo}/${values.currentGpuContext}`
        : "unavailable",
    scaleFactor: scaling.scaleFactor,
    sourceHeight: values.sourceHeight,
    sourceWidth: values.sourceWidth,
    viewportHeight: values.viewportHeight,
    viewportWidth: values.viewportWidth,
    vsrConfirmationSignal: "unavailable",
    vsrConfirmed: false,
    softwareDeinterlaceFallbackAttached:
      values.filterGraph.softwareFallbackAttached,
    vsrFilterAttached: values.filterGraph.vsrFilterAttached,
    vsrRequested: graph.vsrRequested,
  };
}
