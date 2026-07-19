export const IPC_CHANNELS = {
  cycleTestChannel: "coax:cycle-test-channel",
  getRuntimeVersions: "coax:get-runtime-versions",
} as const;

export type TestChannelDirection = "next" | "previous";

export interface RuntimeVersions {
  chrome: string;
  electron: string;
  node: string;
}

export interface CoaxApi {
  cycleTestChannel: (direction: TestChannelDirection) => Promise<void>;
  getRuntimeVersions: () => Promise<RuntimeVersions>;
}
