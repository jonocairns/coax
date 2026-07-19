export const IPC_CHANNELS = {
  getRuntimeVersions: "coax:get-runtime-versions",
} as const;

export interface RuntimeVersions {
  chrome: string;
  electron: string;
  node: string;
}

export interface CoaxApi {
  getRuntimeVersions: () => Promise<RuntimeVersions>;
}
