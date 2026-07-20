export type MpvPlaybackProfileName = "d3d11va" | "nvdec" | "software";

export interface D3d11Adapter {
  description: string;
  index: number;
  vendorId: number;
}

export interface AdapterSelection {
  adapter: D3d11Adapter;
  defaultAdapter: D3d11Adapter;
  explicit: boolean;
  reason: "default-rtx" | "rtx-default-differs" | "vendor-neutral-default";
}

export interface MpvPlaybackProfile {
  fallbackScaler: "ewa_lanczossharp";
  hwdec: "d3d11va" | "no" | "nvdec";
  name: MpvPlaybackProfileName;
  requestVsr: boolean;
}

export const DEFAULT_MPV_PLAYBACK_PROFILE: MpvPlaybackProfileName = "d3d11va";

const PROFILES: Readonly<Record<MpvPlaybackProfileName, MpvPlaybackProfile>> = {
  d3d11va: {
    fallbackScaler: "ewa_lanczossharp",
    hwdec: "d3d11va",
    name: "d3d11va",
    requestVsr: true,
  },
  nvdec: {
    fallbackScaler: "ewa_lanczossharp",
    hwdec: "nvdec",
    name: "nvdec",
    requestVsr: true,
  },
  software: {
    fallbackScaler: "ewa_lanczossharp",
    hwdec: "no",
    name: "software",
    requestVsr: false,
  },
};

export function resolveMpvPlaybackProfile(
  requested: string | undefined,
): MpvPlaybackProfile {
  const name = requested ?? DEFAULT_MPV_PLAYBACK_PROFILE;
  if (name !== "d3d11va" && name !== "nvdec" && name !== "software") {
    throw new Error("invalid-mpv-playback-profile");
  }
  return PROFILES[name];
}

export function parseD3d11Adapters(output: string): readonly D3d11Adapter[] {
  const adapters: D3d11Adapter[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match =
      /^Adapter (\d+): vendor: (\d+), description: ([^\r\n]{1,160})$/.exec(
        line.trim(),
      );
    if (!match) continue;
    const [, rawIndex, rawVendorId, rawDescription] = match;
    const index = Number(rawIndex);
    const vendorId = Number(rawVendorId);
    const description = rawDescription?.trim() ?? "";
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      !Number.isSafeInteger(vendorId) ||
      vendorId < 0 ||
      description.length === 0
    ) {
      continue;
    }
    adapters.push({ description, index, vendorId });
  }
  return adapters;
}

export function selectD3d11Adapter(
  adapters: readonly D3d11Adapter[],
): AdapterSelection {
  const defaultAdapter = adapters[0];
  if (!defaultAdapter) throw new Error("mpv-d3d11-adapters-unavailable");
  const rtx = adapters.find(
    (adapter) =>
      /\bnvidia\b/i.test(adapter.description) &&
      /\brtx\b/i.test(adapter.description),
  );
  if (!rtx) {
    return {
      adapter: defaultAdapter,
      defaultAdapter,
      explicit: false,
      reason: "vendor-neutral-default",
    };
  }
  return {
    adapter: rtx,
    defaultAdapter,
    explicit: rtx.index !== defaultAdapter.index,
    reason:
      rtx.index === defaultAdapter.index
        ? "default-rtx"
        : "rtx-default-differs",
  };
}

export function buildHardwareProfileArguments(
  profile: MpvPlaybackProfile,
  selection: AdapterSelection,
): readonly string[] {
  return [
    "--vo=gpu-next",
    "--gpu-api=d3d11",
    "--gpu-context=d3d11",
    `--d3d11-adapter=${selection.adapter.description}`,
    `--hwdec=${profile.hwdec}`,
    "--hwdec-software-fallback=yes",
    `--scale=${profile.fallbackScaler}`,
  ];
}
