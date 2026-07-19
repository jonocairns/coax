import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS, type RuntimeVersions } from "../shared/api";
import { MpvController } from "./mpv/controller";
import { readLocalPlaybackInput } from "./mpv/playback-input";
import { loadVerifiedMpvRuntime } from "./mpv/runtime-manifest";
import { StructuredPlaybackLogger } from "./mpv/structured-log";
import { createMainWindowOptions } from "./window-options";

let playbackLogger: StructuredPlaybackLogger | null = null;
let mpvController: MpvController | null = null;
let playbackStartup: Promise<void> = Promise.resolve();
let shutdownStarted = false;
let shutdownComplete = false;

function runtimeVersions(): RuntimeVersions {
  return {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRuntimeVersions, () => runtimeVersions());
  ipcMain.handle(
    IPC_CHANNELS.cycleTestChannel,
    (_, direction: unknown): void => {
      if (direction !== "next" && direction !== "previous") {
        throw new Error("invalid-test-channel-direction");
      }
      if (!mpvController) {
        throw new Error("test-playback-not-ready");
      }
      mpvController.cyclePlaylist(direction);
    },
  );
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

async function startSlice2Playback(): Promise<void> {
  if (process.platform !== "win32" || process.env.COAX_SMOKE_TEST === "1") {
    return;
  }

  const applicationRoot = app.getAppPath();
  playbackLogger = new StructuredPlaybackLogger(applicationRoot);
  let input;
  try {
    input = await readLocalPlaybackInput(applicationRoot);
  } catch {
    playbackLogger.write("playback-startup-failed", 0, {
      reason: "invalid-local-input",
    });
    return;
  }
  if (!input) {
    playbackLogger.write("playback-input-missing", 0, {
      reason: "local-input-not-configured",
    });
    return;
  }
  try {
    const runtime = await loadVerifiedMpvRuntime(applicationRoot);
    playbackLogger.write("mpv-runtime-verified", 1, {
      artifactSha256: runtime.manifest.artifact.sha256,
      architecture: runtime.manifest.target.arch,
      mpvCommit: runtime.manifest.source.mpvCommit,
      ffmpegCommit: runtime.manifest.source.ffmpegCommit,
    });
    mpvController = new MpvController(runtime, playbackLogger);
    await mpvController.start(input);
  } catch {
    playbackLogger.write("playback-startup-failed", 1, {
      reason: "runtime-or-mpv-startup-failure",
    });
  }
}

async function shutdownOwnedProcesses(): Promise<void> {
  try {
    await playbackStartup;
    await mpvController?.shutdown();
    await playbackLogger?.close();
  } finally {
    shutdownComplete = true;
    app.quit();
  }
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
  playbackStartup = startSlice2Playback();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (!shutdownStarted) {
    shutdownStarted = true;
    void shutdownOwnedProcesses();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
