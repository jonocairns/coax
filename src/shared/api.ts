import type { OverlayAction, OverlayState } from "./overlay";
import type {
  ChannelPlaybackIntentResult,
  ProviderViewState,
  RapidProviderPlaybackResult,
} from "./provider";

export const IPC_CHANNELS = {
  cycleTestChannel: "coax:cycle-test-channel",
  getRuntimeVersions: "coax:get-runtime-versions",
  getOverlayState: "coax:get-overlay-state",
  getProviderState: "coax:get-provider-state",
  overlayStateChanged: "coax:overlay-state-changed",
  playProviderChannel: "coax:play-provider-channel",
  providerStateChanged: "coax:provider-state-changed",
  requestOverlayAction: "coax:request-overlay-action",
  runRapidPlaylistTest: "coax:run-rapid-playlist-test",
  runRapidProviderTest: "coax:run-rapid-provider-test",
  setOverlayPointerCapture: "coax:set-overlay-pointer-capture",
  toggleFullscreen: "coax:toggle-fullscreen",
} as const;

export type TestChannelDirection = "next" | "previous";

export interface RuntimeVersions {
  chrome: string;
  electron: string;
  node: string;
  slice6Acceptance: boolean;
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
  getProviderState: () => Promise<ProviderViewState>;
  onOverlayState: (listener: (state: OverlayState) => void) => () => void;
  onProviderState: (listener: (state: ProviderViewState) => void) => () => void;
  playProviderChannel: (
    channelId: string,
  ) => Promise<ChannelPlaybackIntentResult>;
  requestOverlayAction: (action: OverlayAction) => Promise<OverlayState>;
  runRapidPlaylistTest: () => Promise<RapidPlaylistTestResult>;
  runRapidProviderTest: () => Promise<RapidProviderPlaybackResult>;
  setOverlayPointerCapture: (capture: boolean) => Promise<void>;
  toggleFullscreen: () => Promise<boolean>;
}
