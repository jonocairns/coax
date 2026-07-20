import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type CoaxApi,
  type PlaylistIntentResult,
  type RapidPlaylistTestResult,
  type RuntimeVersions,
  type TestChannelDirection,
} from "../shared/api";
import type {
  ChannelPlaybackIntentResult,
  ProviderViewState,
  RapidProviderPlaybackResult,
} from "../shared/provider";
import type { OverlayAction, OverlayState } from "../shared/overlay";

const api: CoaxApi = Object.freeze({
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
  toggleFullscreen: () =>
    ipcRenderer.invoke(IPC_CHANNELS.toggleFullscreen) as Promise<boolean>,
});

contextBridge.exposeInMainWorld("coax", api);
