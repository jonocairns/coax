import { describe, expect, it } from "vitest";
import { extractElectronGpuDiagnostics } from "../src/main/electron-gpu";

describe("Electron GPU diagnostics", () => {
  it("retains configuration values without device identifiers", () => {
    const result = extractElectronGpuDiagnostics({
      auxAttributes: {
        glRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11, D3D11)",
      },
      gpuDevice: [
        {
          active: true,
          deviceId: 12345,
          driverVersion: "32.0.16.1062",
          vendorId: 4318,
        },
      ],
    });

    expect(result).toEqual({
      activeGpu: "NVIDIA GeForce RTX 5080",
      driverVersion: "32.0.16.1062",
    });
    expect(result).not.toHaveProperty("deviceId");
  });
});
