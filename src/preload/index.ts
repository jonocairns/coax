import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type CoaxApi,
  type PlaylistIntentResult,
  type RapidPlaylistTestResult,
  type RuntimeVersions,
  type TestChannelDirection,
} from "../shared/api";
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
  onOverlayState: (listener: (state: OverlayState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OverlayState) =>
      listener(state);
    ipcRenderer.on(IPC_CHANNELS.overlayStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.overlayStateChanged, handler);
  },
  requestOverlayAction: (action: OverlayAction) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.requestOverlayAction,
      action,
    ) as Promise<OverlayState>,
  runRapidPlaylistTest: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.runRapidPlaylistTest,
    ) as Promise<RapidPlaylistTestResult>,
  setOverlayPointerCapture: (capture: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.setOverlayPointerCapture,
      capture,
    ) as Promise<void>,
  toggleFullscreen: () =>
    ipcRenderer.invoke(IPC_CHANNELS.toggleFullscreen) as Promise<boolean>,
});

contextBridge.exposeInMainWorld("coax", api);
