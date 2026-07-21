import { describe, expect, it } from "vitest";
import {
  resolveDeinterlacePolicy,
  resolveSportsFixtureProfile,
  SPORTS_FIXTURE_PROFILES,
} from "../src/main/mpv/sports-profile";

describe("Slice 7 sports fixture and field-order profiles", () => {
  it("constructs progressive, correct TFF/BFF, wrong-metadata, and soak cases", () => {
    expect(SPORTS_FIXTURE_PROFILES).toHaveLength(9);
    expect(resolveSportsFixtureProfile("sports-720p5994.mkv")).toMatchObject({
      expectedOutputFps: 60_000 / 1_001,
      scan: "progressive",
    });
    expect(resolveSportsFixtureProfile("sports-576i50-bff.mkv")).toMatchObject({
      contentFieldOrder: "bff",
      metadataFieldOrder: "bff",
      scan: "interlaced",
    });
    expect(
      resolveSportsFixtureProfile("sports-1080i50-wrong-tff.mkv"),
    ).toMatchObject({
      contentFieldOrder: "bff",
      metadataFieldOrder: "tff",
    });
    expect(resolveSportsFixtureProfile("private-provider.ts")).toBeNull();
  });

  it("uses metadata by default and makes an explicit override authoritative", () => {
    expect(resolveDeinterlacePolicy(undefined, false)).toMatchObject({
      fieldOrder: "auto",
      forceHardwareFailure: false,
      interlacedOnly: true,
      mode: "adaptive",
    });
    expect(resolveDeinterlacePolicy("tff", true)).toMatchObject({
      fieldOrder: "tff",
      forceHardwareFailure: true,
      interlacedOnly: false,
    });
    expect(() => resolveDeinterlacePolicy("guess", false)).toThrow(
      "invalid-deinterlace-field-order",
    );
    expect(resolveDeinterlacePolicy("auto", false, false).enabled).toBe(false);
  });
});
