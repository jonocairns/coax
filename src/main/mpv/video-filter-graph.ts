import type { DeinterlacePolicy, FieldOrder } from "./sports-profile";
import type { VideoScaleDecision } from "./video-scaling";

export const COAX_VIDEO_FILTER_LABEL = "coax-video";
export const COAX_DEINTERLACE_FALLBACK_FILTER_LABEL =
  "coax-deinterlace-fallback";

export type VideoFilterPath = "clear" | "d3d11vpp" | "software-fallback";

export interface VideoFilterGraphDecision {
  deinterlaceRequested: boolean;
  fieldOrder: FieldOrder;
  filterSpec: string;
  interlacedOnly: boolean;
  path: VideoFilterPath;
  scaleFactor: number | null;
  vsrRequested: boolean;
}

export interface VideoFilterGraphInspection {
  deinterlaceFilterAttached: boolean;
  d3d11vppAttached: boolean;
  duplicateOwnedFilterCount: number;
  softwareFallbackAttached: boolean;
  vsrFilterAttached: boolean;
}

export function isCurrentVideoFilterGraph(
  latestGeneration: number,
  resultGeneration: number,
  latestRevision: number,
  resultRevision: number | undefined,
): boolean {
  return (
    Number.isSafeInteger(latestGeneration) &&
    latestGeneration === resultGeneration &&
    Number.isSafeInteger(latestRevision) &&
    latestRevision === resultRevision
  );
}

export function fallbackPathAfterFailure(
  path: VideoFilterPath,
): "clear" | "software-fallback" | null {
  if (path === "d3d11vpp") return "software-fallback";
  if (path === "software-fallback") return "clear";
  return null;
}

function stringParameter(
  entry: Record<string, unknown>,
  name: string,
): string | null {
  const params = entry.params;
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params) ||
    !(name in params)
  ) {
    return null;
  }
  const value = (params as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
}

export function createD3d11VideoFilterGraph(
  scaling: VideoScaleDecision,
  deinterlace: DeinterlacePolicy,
): VideoFilterGraphDecision {
  const options: string[] = [];
  if (deinterlace.enabled) {
    options.push(
      "deint=yes",
      `interlaced-only=${deinterlace.interlacedOnly ? "yes" : "no"}`,
      `mode=${deinterlace.mode}`,
      `parity=${deinterlace.fieldOrder}`,
    );
  }
  if (scaling.vsrRequested && scaling.scaleFactor !== null) {
    options.push(`scale=${scaling.scaleFactor}`, "scaling-mode=nvidia");
  }
  if (options.length === 0) {
    return {
      deinterlaceRequested: false,
      fieldOrder: deinterlace.fieldOrder,
      filterSpec: "",
      interlacedOnly: deinterlace.interlacedOnly,
      path: "clear",
      scaleFactor: null,
      vsrRequested: false,
    };
  }
  return {
    deinterlaceRequested: deinterlace.enabled,
    fieldOrder: deinterlace.fieldOrder,
    filterSpec: `@${COAX_VIDEO_FILTER_LABEL}:d3d11vpp=${options.join(":")}`,
    interlacedOnly: deinterlace.interlacedOnly,
    path: "d3d11vpp",
    scaleFactor: scaling.scaleFactor,
    vsrRequested: scaling.vsrRequested,
  };
}

export function createSoftwareDeinterlaceFallbackGraph(
  fieldOrder: FieldOrder,
): VideoFilterGraphDecision {
  const deint = fieldOrder === "auto" ? "interlaced" : "all";
  return {
    deinterlaceRequested: true,
    fieldOrder,
    filterSpec: `@${COAX_DEINTERLACE_FALLBACK_FILTER_LABEL}:bwdif=mode=send_field:parity=${fieldOrder}:deint=${deint}`,
    interlacedOnly: deint === "interlaced",
    path: "software-fallback",
    scaleFactor: null,
    vsrRequested: false,
  };
}

export function inspectVideoFilterGraph(
  value: unknown,
): VideoFilterGraphInspection {
  const inspection: VideoFilterGraphInspection = {
    deinterlaceFilterAttached: false,
    d3d11vppAttached: false,
    duplicateOwnedFilterCount: 0,
    softwareFallbackAttached: false,
    vsrFilterAttached: false,
  };
  if (!Array.isArray(value)) return inspection;

  let ownedCount = 0;
  for (const candidate of value) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const entry = candidate as Record<string, unknown>;
    if (entry.enabled === false) continue;
    if (
      entry.label !== COAX_VIDEO_FILTER_LABEL &&
      entry.label !== COAX_DEINTERLACE_FALLBACK_FILTER_LABEL
    ) {
      continue;
    }
    ownedCount += 1;
    if (entry.label === COAX_VIDEO_FILTER_LABEL && entry.name === "d3d11vpp") {
      inspection.d3d11vppAttached = true;
      inspection.deinterlaceFilterAttached =
        stringParameter(entry, "deint") === "yes";
      const scale = Number(stringParameter(entry, "scale"));
      inspection.vsrFilterAttached =
        stringParameter(entry, "scaling-mode") === "nvidia" && scale > 1;
    }
    if (
      entry.label === COAX_DEINTERLACE_FALLBACK_FILTER_LABEL &&
      entry.name === "bwdif"
    ) {
      inspection.deinterlaceFilterAttached = true;
      inspection.softwareFallbackAttached = true;
    }
  }
  inspection.duplicateOwnedFilterCount = Math.max(0, ownedCount - 1);
  return inspection;
}
