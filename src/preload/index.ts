import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type CoaxApi,
  type PlaylistIntentResult,
  type RapidPlaylistTestResult,
  type RuntimeVersions,
  type TestChannelDirection,
  type VideoViewport,
  type WindowControlAction,
  type WindowState,
} from "../shared/api";
import type {
  ChannelPlaybackIntentResult,
  ProviderViewState,
  RapidProviderPlaybackResult,
  SourceMutationResult,
  XtreamSourceSetupInput,
} from "../shared/provider";
import type { OverlayAction, OverlayState } from "../shared/overlay";
import type { StreamStatsState } from "../shared/stream-stats";

const api: CoaxApi = Object.freeze({
  configureXtreamSource: (input: XtreamSourceSetupInput) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.configureXtreamSource,
      input,
    ) as Promise<SourceMutationResult>,
  cycleTestChannel: (direction: TestChannelDirection) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.cycleTestChannel,
      direction,
    ) as Promise<PlaylistIntentResult>,
  getRuntimeVersions: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.getRuntimeVersions,
    ) as Promise<RuntimeVersions>,
  getOverlayState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getOverlayState) as Promise<OverlayState>,
  getProviderState: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.getProviderState,
    ) as Promise<ProviderViewState>,
  getStreamStatsState: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.getStreamStatsState,
    ) as Promise<StreamStatsState>,
  getWindowState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getWindowState) as Promise<WindowState>,
  onOverlayState: (listener: (state: OverlayState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OverlayState) =>
      listener(state);
    ipcRenderer.on(IPC_CHANNELS.overlayStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.overlayStateChanged, handler);
  },
  onProviderState: (listener: (state: ProviderViewState) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: ProviderViewState,
    ) => listener(state);
    ipcRenderer.on(IPC_CHANNELS.providerStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.providerStateChanged, handler);
  },
  onStreamStatsState: (listener: (state: StreamStatsState) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: StreamStatsState,
    ) => listener(state);
    ipcRenderer.on(IPC_CHANNELS.streamStatsStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.streamStatsStateChanged, handler);
  },
  onWindowState: (listener: (state: WindowState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowState) =>
      listener(state);
    ipcRenderer.on(IPC_CHANNELS.windowStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.windowStateChanged, handler);
  },
  playProviderChannel: (channelId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.playProviderChannel,
      channelId,
    ) as Promise<ChannelPlaybackIntentResult>,
  requestOverlayAction: (action: OverlayAction) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.requestOverlayAction,
      action,
    ) as Promise<OverlayState>,
  removeXtreamSource: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.removeXtreamSource,
    ) as Promise<SourceMutationResult>,
  runRapidPlaylistTest: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.runRapidPlaylistTest,
    ) as Promise<RapidPlaylistTestResult>,
  runRapidProviderTest: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.runRapidProviderTest,
    ) as Promise<RapidProviderPlaybackResult>,
  setOverlayPointerCapture: (capture: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.setOverlayPointerCapture,
      capture,
    ) as Promise<void>,
  setVideoPreviewVisible: (visible: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.setVideoPreviewVisible,
      visible,
    ) as Promise<void>,
  setVideoViewport: (viewport: VideoViewport | null) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.setVideoViewport,
      viewport,
    ) as Promise<void>,
  setVolume: (volume: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.setVolume, volume) as Promise<OverlayState>,
  stopPlayback: () =>
    ipcRenderer.invoke(IPC_CHANNELS.stopPlayback) as Promise<OverlayState>,
  toggleMute: () =>
    ipcRenderer.invoke(IPC_CHANNELS.toggleMute) as Promise<OverlayState>,
  toggleFullscreen: () =>
    ipcRenderer.invoke(IPC_CHANNELS.toggleFullscreen) as Promise<boolean>,
  windowControl: (action: WindowControlAction) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.windowControl,
      action,
    ) as Promise<WindowState>,
});

contextBridge.exposeInMainWorld("coax", api);
