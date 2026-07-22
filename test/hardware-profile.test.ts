import { describe, expect, it } from "vitest";
import {
  buildHardwareProfileArguments,
  parseD3d11Adapters,
  resolveMpvPlaybackProfile,
  selectD3d11Adapter,
} from "../src/main/mpv/hardware-profile";

describe("mpv hardware profiles and adapter selection", () => {
  const output = [
    "Available DXGI adapters:",
    "Adapter 0: vendor: 4098, description: AMD Radeon(TM) Graphics",
    "Adapter 1: vendor: 4318, description: NVIDIA GeForce RTX 5080",
    "Adapter 2: vendor: 5140, description: Microsoft Basic Render Driver",
  ].join("\r\n");

  it("parses the pinned mpv adapter listing and explicitly selects RTX when needed", () => {
    const adapters = parseD3d11Adapters(output);
    const selected = selectD3d11Adapter(adapters);

    expect(adapters).toHaveLength(3);
    expect(selected.adapter.description).toBe("NVIDIA GeForce RTX 5080");
    expect(selected.defaultAdapter.description).toContain("AMD Radeon");
    expect(selected.explicit).toBe(true);
    expect(selected.reason).toBe("rtx-default-differs");
  });

  it("provides comparable D3D11VA, NVDEC, and software profiles", () => {
    const selection = selectD3d11Adapter(
      parseD3d11Adapters(output.replace("Adapter 0", "Adapter 3")),
    );
    for (const name of ["d3d11va", "nvdec", "software"] as const) {
      const profile = resolveMpvPlaybackProfile(name);
      const arguments_ = buildHardwareProfileArguments(profile, selection);
      expect(arguments_).toContain("--vo=gpu-next");
      expect(arguments_).toContain("--gpu-api=d3d11");
      expect(arguments_).toContain("--gpu-context=d3d11");
      expect(arguments_).toContain(`--hwdec=${profile.hwdec}`);
      expect(arguments_).toContain("--hwdec-software-fallback=yes");
      expect(arguments_).toContain("--scale=ewa_lanczossharp");
    }
    expect(resolveMpvPlaybackProfile("software").requestVsr).toBe(false);
    expect(() => resolveMpvPlaybackProfile("unsafe")).toThrow(
      "invalid-mpv-playback-profile",
    );
  });
});
