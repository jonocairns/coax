export interface ElectronGpuDiagnostics {
  activeGpu: string;
  driverVersion: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gpuName(value: string): string | null {
  const nvidia = /NVIDIA GeForce RTX \d{4}(?: Ti)?/i.exec(value)?.[0];
  if (nvidia) return nvidia.replace(/^nvidia/i, "NVIDIA");
  const amd = /AMD Radeon(?:\(TM\))? [A-Za-z0-9 +_-]{1,80}/i.exec(value)?.[0];
  return amd?.trim() ?? null;
}

export function extractElectronGpuDiagnostics(
  value: unknown,
): ElectronGpuDiagnostics {
  if (!isRecord(value)) {
    return { activeGpu: "unavailable", driverVersion: "unavailable" };
  }
  const devices = Array.isArray(value.gpuDevice) ? value.gpuDevice : [];
  const active = devices.find(
    (device) => isRecord(device) && device.active === true,
  );
  let activeGpu = "unavailable";
  let driverVersion = "unavailable";
  if (isRecord(active)) {
    for (const key of ["deviceString", "description", "vendorString"]) {
      const candidate = active[key];
      if (typeof candidate === "string") {
        const name = gpuName(candidate);
        if (name) activeGpu = name;
      }
    }
    if (
      typeof active.driverVersion === "string" &&
      /^[0-9.]{1,32}$/.test(active.driverVersion)
    ) {
      driverVersion = active.driverVersion;
    }
  }
  const auxiliary = value.auxAttributes;
  if (isRecord(auxiliary)) {
    for (const key of ["glRenderer", "glVendor", "displayType"]) {
      const candidate = auxiliary[key];
      if (typeof candidate === "string") {
        const name = gpuName(candidate);
        if (name) activeGpu = name;
      }
    }
    if (
      driverVersion === "unavailable" &&
      typeof auxiliary.driverVersion === "string" &&
      /^[0-9.]{1,32}$/.test(auxiliary.driverVersion)
    ) {
      driverVersion = auxiliary.driverVersion;
    }
  }
  return { activeGpu, driverVersion };
}
