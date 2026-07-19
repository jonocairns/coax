import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type CoaxApi,
  type RuntimeVersions,
  type TestChannelDirection,
} from "../shared/api";

const api: CoaxApi = Object.freeze({
  cycleTestChannel: (direction: TestChannelDirection) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.cycleTestChannel,
      direction,
    ) as Promise<void>,
  getRuntimeVersions: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.getRuntimeVersions,
    ) as Promise<RuntimeVersions>,
});

contextBridge.exposeInMainWorld("coax", api);
