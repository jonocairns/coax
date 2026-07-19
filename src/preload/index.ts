import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type CoaxApi,
  type RuntimeVersions,
} from "../shared/api";

const api: CoaxApi = Object.freeze({
  getRuntimeVersions: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.getRuntimeVersions,
    ) as Promise<RuntimeVersions>,
});

contextBridge.exposeInMainWorld("coax", api);
