export const COAX_VSR_FILTER_LABEL = "coax-vsr";
export const MAX_VSR_SCALE_FACTOR = 4;

export interface VideoSize {
  height: number;
  width: number;
}

export interface VideoScaleDecision {
  fallbackScaler: "ewa_lanczossharp";
  reason:
    | "invalid-dimensions"
    | "source-fills-viewport"
    | "vsr-profile-disabled"
    | "vsr-upscale";
  scaleFactor: number | null;
  vsrRequested: boolean;
}

function validSize(size: VideoSize): boolean {
  return (
    Number.isSafeInteger(size.width) &&
    size.width > 0 &&
    Number.isSafeInteger(size.height) &&
    size.height > 0
  );
}

export function decideVideoScaling(
  source: VideoSize,
  viewport: VideoSize,
  requestVsr: boolean,
): VideoScaleDecision {
  const fallbackScaler = "ewa_lanczossharp" as const;
  if (!validSize(source) || !validSize(viewport)) {
    return {
      fallbackScaler,
      reason: "invalid-dimensions",
      scaleFactor: null,
      vsrRequested: false,
    };
  }
  if (!requestVsr) {
    return {
      fallbackScaler,
      reason: "vsr-profile-disabled",
      scaleFactor: null,
      vsrRequested: false,
    };
  }
  if (source.width >= viewport.width || source.height >= viewport.height) {
    return {
      fallbackScaler,
      reason: "source-fills-viewport",
      scaleFactor: null,
      vsrRequested: false,
    };
  }

  const rawFactor = Math.min(
    viewport.width / source.width,
    viewport.height / source.height,
  );
  if (!Number.isFinite(rawFactor) || rawFactor <= 1) {
    return {
      fallbackScaler,
      reason: "source-fills-viewport",
      scaleFactor: null,
      vsrRequested: false,
    };
  }
  const scaleFactor =
    Math.round(Math.min(rawFactor, MAX_VSR_SCALE_FACTOR) * 1_000_000) /
    1_000_000;
  return {
    fallbackScaler,
    reason: "vsr-upscale",
    scaleFactor,
    vsrRequested: true,
  };
}

export function isCoaxVsrFilterAttached(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      "label" in entry &&
      entry.label === COAX_VSR_FILTER_LABEL &&
      "name" in entry &&
      entry.name === "d3d11vpp" &&
      (!("enabled" in entry) || entry.enabled !== false),
  );
}

export function createVsrFilterSpec(scaleFactor: number): string {
  if (
    !Number.isFinite(scaleFactor) ||
    scaleFactor <= 1 ||
    scaleFactor > MAX_VSR_SCALE_FACTOR
  ) {
    throw new Error("invalid-vsr-scale-factor");
  }
  return `@${COAX_VSR_FILTER_LABEL}:d3d11vpp=scale=${scaleFactor}:scaling-mode=nvidia`;
}

export function isCurrentScalingGeneration(
  latestGeneration: number,
  updateGeneration: number,
): boolean {
  return (
    Number.isSafeInteger(latestGeneration) &&
    Number.isSafeInteger(updateGeneration) &&
    latestGeneration === updateGeneration
  );
}
