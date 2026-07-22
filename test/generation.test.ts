import { describe, expect, it } from "vitest";
import {
  decideGeneration,
  shouldApplyGeneration,
} from "../src/shared/generation";

describe("generation decisions", () => {
  it("accepts only the latest requested playback result as current", () => {
    expect(decideGeneration(31, 30)).toBe("stale");
    expect(decideGeneration(31, 31)).toBe("current");
    expect(decideGeneration(31, 32)).toBe("future");
  });

  it("prevents late renderer results from replacing a newer generation", () => {
    expect(shouldApplyGeneration(31, 30)).toBe(false);
    expect(shouldApplyGeneration(31, 31)).toBe(true);
    expect(shouldApplyGeneration(31, 32)).toBe(true);
  });
});
