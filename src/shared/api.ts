import type { OverlayAction, OverlayState } from "./overlay";
import type {
  ChannelPlaybackIntentResult,
  ProviderViewState,
  RapidProviderPlaybackResult,
  SourceMutationResult,
  XtreamSourceSetupInput,
} from "./provider";
import type { StreamStatsState } from "./stream-stats";

export const IPC_CHANNELS = {
  cycleTestChannel: "coax:cycle-test-channel",
  configureXtreamSource: "coax:configure-xtream-source",
  getRuntimeVersions: "coax:get-runtime-versions",
  getOverlayState: "coax:get-overlay-state",
  getProviderState: "coax:get-provider-state",
  getStreamStatsState: "coax:get-stream-stats-state",
  getWindowState: "coax:get-window-state",
  overlayStateChanged: "coax:overlay-state-changed",
  playProviderChannel: "coax:play-provider-channel",
  providerStateChanged: "coax:provider-state-changed",
  requestOverlayAction: "coax:request-overlay-action",
  removeXtreamSource: "coax:remove-xtream-source",
  runRapidPlaylistTest: "coax:run-rapid-playlist-test",
  runRapidProviderTest: "coax:run-rapid-provider-test",
  setOverlayPointerCapture: "coax:set-overlay-pointer-capture",
  setVideoPreviewVisible: "coax:set-video-preview-visible",
  setVideoViewport: "coax:set-video-viewport",
  setVolume: "coax:set-volume",
  stopPlayback: "coax:stop-playback",
  streamStatsStateChanged: "coax:stream-stats-state-changed",
  toggleMute: "coax:toggle-mute",
  toggleFullscreen: "coax:toggle-fullscreen",
  windowControl: "coax:window-control",
  windowStateChanged: "coax:window-state-changed",
} as const;

export type TestChannelDirection = "next" | "previous";

export interface RuntimeVersions {
  chrome: string;
  electron: string;
  node: string;
  slice6Acceptance: boolean;
  slice7Acceptance: boolean;
}

export type WindowControlAction = "close" | "minimize" | "toggle-maximize";

export interface WindowState {
  fullscreen: boolean;
  maximized: boolean;
}

export interface PlaylistIntentResult {
  direction: TestChannelDirection;
  generation: number;
}

export interface VideoViewport {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface RapidPlaylistTestResult {
  finalDirection: TestChannelDirection;
  finalGeneration: number;
  requestCount: 30;
}

export interface CoaxApi {
  configureXtreamSource: (
    input: XtreamSourceSetupInput,
  ) => Promise<SourceMutationResult>;
  cycleTestChannel: (
    direction: TestChannelDirection,
  ) => Promise<PlaylistIntentResult>;
  getRuntimeVersions: () => Promise<RuntimeVersions>;
  getOverlayState: () => Promise<OverlayState>;
  getProviderState: () => Promise<ProviderViewState>;
  getStreamStatsState: () => Promise<StreamStatsState>;
  getWindowState: () => Promise<WindowState>;
  onOverlayState: (listener: (state: OverlayState) => void) => () => void;
  onProviderState: (listener: (state: ProviderViewState) => void) => () => void;
  onStreamStatsState: (
    listener: (state: StreamStatsState) => void,
  ) => () => void;
  onWindowState: (listener: (state: WindowState) => void) => () => void;
  playProviderChannel: (
    channelId: string,
  ) => Promise<ChannelPlaybackIntentResult>;
  requestOverlayAction: (action: OverlayAction) => Promise<OverlayState>;
  removeXtreamSource: () => Promise<SourceMutationResult>;
  runRapidPlaylistTest: () => Promise<RapidPlaylistTestResult>;
  runRapidProviderTest: () => Promise<RapidProviderPlaybackResult>;
  setOverlayPointerCapture: (capture: boolean) => Promise<void>;
  setVideoPreviewVisible: (visible: boolean) => Promise<void>;
  setVideoViewport: (viewport: VideoViewport | null) => Promise<void>;
  setVolume: (volume: number) => Promise<OverlayState>;
  stopPlayback: () => Promise<OverlayState>;
  toggleMute: () => Promise<OverlayState>;
  toggleFullscreen: () => Promise<boolean>;
  windowControl: (action: WindowControlAction) => Promise<WindowState>;
}
