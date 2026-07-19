import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS, type RuntimeVersions } from "../shared/api";
import { createMainWindowOptions } from "./window-options";

function runtimeVersions(): RuntimeVersions {
  return {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRuntimeVersions, () => runtimeVersions());
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions(join(__dirname, "../preload/index.js")),
  );

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    window.show();

    if (process.env.COAX_SMOKE_TEST === "1") {
      console.log(
        JSON.stringify({
          event: "coax-smoke-ready",
          runtime: runtimeVersions(),
        }),
      );
      setTimeout(() => app.quit(), 500);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
