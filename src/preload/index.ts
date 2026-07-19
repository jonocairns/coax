import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type CoaxApi,
  type PlaylistIntentResult,
  type RapidPlaylistTestResult,
  type RuntimeVersions,
  type TestChannelDirection,
} from "../shared/api";

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
  runRapidPlaylistTest: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.runRapidPlaylistTest,
    ) as Promise<RapidPlaylistTestResult>,
  toggleFullscreen: () =>
    ipcRenderer.invoke(IPC_CHANNELS.toggleFullscreen) as Promise<boolean>,
});

contextBridge.exposeInMainWorld("coax", api);
