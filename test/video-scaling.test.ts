import { describe, expect, it } from "vitest";
import {
  createVsrFilterSpec,
  decideVideoScaling,
  isCoaxVsrFilterAttached,
  isCurrentScalingGeneration,
} from "../src/main/mpv/video-scaling";

describe("viewport-aware video scaling", () => {
  it("requests a bounded 720p to 4K factor only when both dimensions upscale", () => {
    expect(
      decideVideoScaling(
        { width: 1280, height: 720 },
        { width: 3840, height: 2160 },
        true,
      ),
    ).toMatchObject({
      reason: "vsr-upscale",
      scaleFactor: 3,
      vsrRequested: true,
    });
    expect(
      decideVideoScaling(
        { width: 320, height: 180 },
        { width: 3840, height: 2160 },
        true,
      ).scaleFactor,
    ).toBe(4);
    expect(
      decideVideoScaling(
        { width: 3840, height: 2160 },
        { width: 3840, height: 2160 },
        true,
      ).vsrRequested,
    ).toBe(false);
  });

  it("recomputes decisions across source and viewport changes", () => {
    const source720 = { width: 1280, height: 720 };
    expect(
      decideVideoScaling(source720, { width: 1920, height: 1080 }, true)
        .scaleFactor,
    ).toBe(1.5);
    expect(
      decideVideoScaling(
        { width: 1920, height: 1080 },
        { width: 3840, height: 2160 },
        true,
      ).scaleFactor,
    ).toBe(2);
    expect(
      decideVideoScaling(source720, { width: 960, height: 540 }, true)
        .vsrRequested,
    ).toBe(false);
  });

  it("distinguishes a requested filter from an attached filter and rejects stale generations", () => {
    const spec = createVsrFilterSpec(3);
    expect(spec).toBe("@coax-vsr:d3d11vpp=scale=3:scaling-mode=nvidia");
    expect(
      isCoaxVsrFilterAttached([
        {
          label: "coax-vsr",
          name: "d3d11vpp",
          params: { scale: "3", "scaling-mode": "nvidia" },
        },
      ]),
    ).toBe(true);
    expect(isCoaxVsrFilterAttached([])).toBe(false);
    expect(isCurrentScalingGeneration(8, 8)).toBe(true);
    expect(isCurrentScalingGeneration(8, 7)).toBe(false);
  });
});
