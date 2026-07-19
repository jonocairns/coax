export const IPC_CHANNELS = {
  cycleTestChannel: "coax:cycle-test-channel",
  getRuntimeVersions: "coax:get-runtime-versions",
  runRapidPlaylistTest: "coax:run-rapid-playlist-test",
  toggleFullscreen: "coax:toggle-fullscreen",
} as const;

export type TestChannelDirection = "next" | "previous";

export interface RuntimeVersions {
  chrome: string;
  electron: string;
  node: string;
}

export interface PlaylistIntentResult {
  direction: TestChannelDirection;
  generation: number;
}

export interface RapidPlaylistTestResult {
  finalDirection: TestChannelDirection;
  finalGeneration: number;
  requestCount: 30;
}

export interface CoaxApi {
  cycleTestChannel: (
    direction: TestChannelDirection,
  ) => Promise<PlaylistIntentResult>;
  getRuntimeVersions: () => Promise<RuntimeVersions>;
  runRapidPlaylistTest: () => Promise<RapidPlaylistTestResult>;
  toggleFullscreen: () => Promise<boolean>;
}
