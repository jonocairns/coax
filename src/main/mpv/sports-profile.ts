export type FieldOrder = "auto" | "bff" | "tff";

export type SportsFixtureScan = "interlaced" | "progressive";

export interface SportsFixtureProfile {
  contentFieldOrder: Exclude<FieldOrder, "auto"> | null;
  expectedOutputFps: number;
  fileName: string;
  height: number;
  metadataFieldOrder: Exclude<FieldOrder, "auto"> | null;
  scan: SportsFixtureScan;
  width: number;
}

export interface DeinterlacePolicy {
  enabled: boolean;
  fieldOrder: FieldOrder;
  forceHardwareFailure: boolean;
  interlacedOnly: boolean;
  mode: "adaptive";
}

export const SPORTS_FIXTURE_PROFILES = [
  {
    contentFieldOrder: null,
    expectedOutputFps: 50,
    fileName: "sports-720p50.mkv",
    height: 720,
    metadataFieldOrder: null,
    scan: "progressive",
    width: 1280,
  },
  {
    contentFieldOrder: null,
    expectedOutputFps: 60_000 / 1_001,
    fileName: "sports-720p5994.mkv",
    height: 720,
    metadataFieldOrder: null,
    scan: "progressive",
    width: 1280,
  },
  {
    contentFieldOrder: "tff",
    expectedOutputFps: 50,
    fileName: "sports-576i50-tff.mkv",
    height: 576,
    metadataFieldOrder: "tff",
    scan: "interlaced",
    width: 720,
  },
  {
    contentFieldOrder: "bff",
    expectedOutputFps: 50,
    fileName: "sports-576i50-bff.mkv",
    height: 576,
    metadataFieldOrder: "bff",
    scan: "interlaced",
    width: 720,
  },
  {
    contentFieldOrder: "tff",
    expectedOutputFps: 50,
    fileName: "sports-1080i50-tff.mkv",
    height: 1080,
    metadataFieldOrder: "tff",
    scan: "interlaced",
    width: 1920,
  },
  {
    contentFieldOrder: "bff",
    expectedOutputFps: 50,
    fileName: "sports-1080i50-bff.mkv",
    height: 1080,
    metadataFieldOrder: "bff",
    scan: "interlaced",
    width: 1920,
  },
  {
    contentFieldOrder: "tff",
    expectedOutputFps: 50,
    fileName: "sports-576i50-wrong-bff.mkv",
    height: 576,
    metadataFieldOrder: "bff",
    scan: "interlaced",
    width: 720,
  },
  {
    contentFieldOrder: "bff",
    expectedOutputFps: 50,
    fileName: "sports-1080i50-wrong-tff.mkv",
    height: 1080,
    metadataFieldOrder: "tff",
    scan: "interlaced",
    width: 1920,
  },
  {
    contentFieldOrder: null,
    expectedOutputFps: 50,
    fileName: "sports-soak-720p50.mkv",
    height: 720,
    metadataFieldOrder: null,
    scan: "progressive",
    width: 1280,
  },
] as const satisfies readonly SportsFixtureProfile[];

export function resolveSportsFixtureProfile(
  fixtureName: string | undefined,
): SportsFixtureProfile | null {
  if (!fixtureName) return null;
  return (
    SPORTS_FIXTURE_PROFILES.find(
      (profile) => profile.fileName === fixtureName,
    ) ?? null
  );
}

export function resolveDeinterlacePolicy(
  requestedFieldOrder: string | undefined,
  forceHardwareFailure: boolean,
  enabled = true,
): DeinterlacePolicy {
  const fieldOrder = requestedFieldOrder ?? "auto";
  if (fieldOrder !== "auto" && fieldOrder !== "tff" && fieldOrder !== "bff") {
    throw new Error("invalid-deinterlace-field-order");
  }
  return {
    enabled,
    fieldOrder,
    forceHardwareFailure,
    // An explicit override also recovers inputs whose interlaced flag is wrong.
    interlacedOnly: fieldOrder === "auto",
    mode: "adaptive",
  };
}
