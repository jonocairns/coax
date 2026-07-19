import type { OverlayAction, OverlayState } from "./overlay";

export const IPC_CHANNELS = {
  cycleTestChannel: "coax:cycle-test-channel",
  getRuntimeVersions: "coax:get-runtime-versions",
  getOverlayState: "coax:get-overlay-state",
  overlayStateChanged: "coax:overlay-state-changed",
  requestOverlayAction: "coax:request-overlay-action",
  runRapidPlaylistTest: "coax:run-rapid-playlist-test",
  setOverlayPointerCapture: "coax:set-overlay-pointer-capture",
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
  getOverlayState: () => Promise<OverlayState>;
  onOverlayState: (listener: (state: OverlayState) => void) => () => void;
  requestOverlayAction: (action: OverlayAction) => Promise<OverlayState>;
  runRapidPlaylistTest: () => Promise<RapidPlaylistTestResult>;
  setOverlayPointerCapture: (capture: boolean) => Promise<void>;
  toggleFullscreen: () => Promise<boolean>;
}
