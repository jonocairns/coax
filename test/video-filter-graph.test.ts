import { describe, expect, it } from "vitest";
import {
  createD3d11VideoFilterGraph,
  createSoftwareDeinterlaceFallbackGraph,
  fallbackPathAfterFailure,
  inspectVideoFilterGraph,
  isCurrentVideoFilterGraph,
} from "../src/main/mpv/video-filter-graph";

const scaling = {
  fallbackScaler: "ewa_lanczossharp" as const,
  reason: "vsr-upscale" as const,
  scaleFactor: 3,
  vsrRequested: true,
};

describe("generation-safe Slice 7 video-filter graph composition", () => {
  it("composes adaptive deinterlacing, parity, and VSR into one D3D11VPP", () => {
    const graph = createD3d11VideoFilterGraph(scaling, {
      enabled: true,
      fieldOrder: "tff",
      forceHardwareFailure: false,
      interlacedOnly: false,
      mode: "adaptive",
    });
    expect(graph.filterSpec).toBe(
      "@coax-video:d3d11vpp=deint=yes:interlaced-only=no:mode=adaptive:parity=tff:scale=3:scaling-mode=nvidia",
    );
    expect(graph.path).toBe("d3d11vpp");
  });

  it("constructs a field-rate software fallback without retaining VSR", () => {
    expect(createSoftwareDeinterlaceFallbackGraph("bff")).toMatchObject({
      filterSpec:
        "@coax-deinterlace-fallback:bwdif=mode=send_field:parity=bff:deint=all",
      path: "software-fallback",
      vsrRequested: false,
    });
    expect(fallbackPathAfterFailure("d3d11vpp")).toBe("software-fallback");
    expect(fallbackPathAfterFailure("software-fallback")).toBe("clear");
  });

  it("rejects old generations and graph revisions during reconfiguration", () => {
    expect(isCurrentVideoFilterGraph(9, 9, 4, 4)).toBe(true);
    expect(isCurrentVideoFilterGraph(9, 8, 4, 4)).toBe(false);
    expect(isCurrentVideoFilterGraph(9, 9, 4, 3)).toBe(false);
  });

  it("detects the exact attached path and duplicate owned graphs", () => {
    expect(
      inspectVideoFilterGraph([
        {
          label: "coax-video",
          name: "d3d11vpp",
          params: {
            deint: "yes",
            mode: "adaptive",
            parity: "auto",
            scale: "3",
            "scaling-mode": "nvidia",
          },
        },
      ]),
    ).toMatchObject({
      deinterlaceFilterAttached: true,
      d3d11vppAttached: true,
      duplicateOwnedFilterCount: 0,
      vsrFilterAttached: true,
    });
    expect(
      inspectVideoFilterGraph([
        { label: "coax-video", name: "d3d11vpp", params: {} },
        { label: "coax-deinterlace-fallback", name: "bwdif", params: {} },
      ]).duplicateOwnedFilterCount,
    ).toBe(1);
  });
});
