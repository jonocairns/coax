import type { AdapterSelection, MpvPlaybackProfile } from "./hardware-profile";
import type { StructuredLogValue } from "./structured-log";
import type { VideoScaleDecision } from "./video-scaling";

export interface VideoDiagnosticValues {
  currentGpuContext: string | null;
  currentVo: string | null;
  decoder: string | null;
  filterAttached: boolean;
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
): Readonly<Record<string, StructuredLogValue>> {
  return {
    adapter: adapterSelection.adapter.description,
    adapterSelectionReason: adapterSelection.reason,
    currentGpuContext: values.currentGpuContext,
    currentVo: values.currentVo,
    decoder: values.decoder,
    fallbackScaler: scaling.fallbackScaler,
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
    vsrFilterAttached: values.filterAttached,
    vsrRequested: scaling.vsrRequested,
  };
}
