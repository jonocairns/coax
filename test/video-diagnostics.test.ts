import { describe, expect, it } from "vitest";
import { resolveMpvPlaybackProfile } from "../src/main/mpv/hardware-profile";
import { createVideoDiagnosticDetails } from "../src/main/mpv/video-diagnostics";

describe("truthful video diagnostics", () => {
  it("never converts a requested and attached filter into an active VSR claim", () => {
    const adapter = {
      adapter: {
        description: "NVIDIA GeForce RTX 5080",
        index: 0,
        vendorId: 4318,
      },
      defaultAdapter: {
        description: "NVIDIA GeForce RTX 5080",
        index: 0,
        vendorId: 4318,
      },
      explicit: false,
      reason: "default-rtx" as const,
    };
    const details = createVideoDiagnosticDetails(
      {
        currentGpuContext: "d3d11",
        currentVo: "gpu-next",
        decoder: "h264",
        filterGraph: {
          deinterlaceFilterAttached: true,
          d3d11vppAttached: true,
          duplicateOwnedFilterCount: 0,
          softwareFallbackAttached: false,
          vsrFilterAttached: true,
        },
        frameInterlaced: false,
        frameRepeat: false,
        frameTff: false,
        hwdecCurrent: "d3d11va",
        hwdecInterop: "d3d11va",
        outputHeight: 2160,
        outputWidth: 3840,
        reason: "video-reconfig",
        sourceHeight: 720,
        sourceWidth: 1280,
        viewportHeight: 2160,
        viewportWidth: 3840,
      },
      resolveMpvPlaybackProfile("d3d11va"),
      adapter,
      {
        fallbackScaler: "ewa_lanczossharp",
        reason: "vsr-upscale",
        scaleFactor: 3,
        vsrRequested: true,
      },
      {
        enabled: true,
        fieldOrder: "auto",
        forceHardwareFailure: false,
        interlacedOnly: true,
        mode: "adaptive",
      },
      {
        deinterlaceRequested: true,
        fieldOrder: "auto",
        filterSpec:
          "@coax-video:d3d11vpp=deint=yes:interlaced-only=yes:mode=adaptive:parity=auto:scale=3:scaling-mode=nvidia",
        interlacedOnly: true,
        path: "d3d11vpp",
        scaleFactor: 3,
        vsrRequested: true,
      },
    );

    expect(details).toMatchObject({
      adapter: "NVIDIA GeForce RTX 5080",
      hwdecCurrent: "d3d11va",
      renderPath: "gpu-next/d3d11",
      deinterlacePath: "d3d11vpp",
      vsrConfirmationSignal: "unavailable",
      vsrConfirmed: false,
      vsrFilterAttached: true,
      vsrRequested: true,
    });
    expect(JSON.stringify(details)).not.toMatch(/active/i);
  });
});
