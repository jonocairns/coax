import { join } from "node:path";
import {
  app,
  BaseWindow,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
} from "electron";
import {
  IPC_CHANNELS,
  type PlaylistIntentResult,
  type RapidPlaylistTestResult,
  type RuntimeVersions,
} from "../shared/api";
import { MpvController } from "./mpv/controller";
import { readLocalPlaybackInput } from "./mpv/playback-input";
import { loadVerifiedMpvRuntime } from "./mpv/runtime-manifest";
import { StructuredPlaybackLogger } from "./mpv/structured-log";
import { nativeWindowHandleToWid } from "./native-window";
import {
  decideGeometrySynchronization,
  presentationState,
  type GeometryReason,
} from "./window-lifecycle";
import { createMainWindowOptions } from "./window-options";

let mainWindow: BrowserWindow | null = null;
let videoWindow: BaseWindow | null = null;
let videoPlaybackReady = false;
let playbackLogger: StructuredPlaybackLogger | null = null;
let mpvController: MpvController | null = null;
let playbackStartup: Promise<void> = Promise.resolve();
let shutdownStarted = false;
let shutdownComplete = false;
const geometryTimers = new Map<GeometryReason, ReturnType<typeof setTimeout>>();

function runtimeVersions(): RuntimeVersions {
  return {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  };
}

function currentWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("main-window-unavailable");
  }
  return mainWindow;
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRuntimeVersions, (): RuntimeVersions =>
    runtimeVersions(),
  );
  ipcMain.handle(
    IPC_CHANNELS.cycleTestChannel,
    (_, direction: unknown): PlaylistIntentResult => {
      if (direction !== "next" && direction !== "previous") {
        throw new Error("invalid-test-channel-direction");
      }
      if (!mpvController) throw new Error("test-playback-not-ready");
      return {
        direction,
        generation: mpvController.cyclePlaylist(direction),
      };
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.runRapidPlaylistTest,
    (): RapidPlaylistTestResult => runRapidPlaylistTest(),
  );
  ipcMain.handle(IPC_CHANNELS.toggleFullscreen, (): boolean => {
    const window = currentWindow();
    toggleMainWindowFullscreen();
    return window.isFullScreen();
  });
}

function runRapidPlaylistTest(): RapidPlaylistTestResult {
  if (!mpvController) throw new Error("test-playback-not-ready");
  let finalDirection: "next" | "previous" = "next";
  let finalGeneration = 0;
  for (let index = 0; index < 30; index += 1) {
    finalDirection = index % 2 === 0 ? "next" : "previous";
    finalGeneration = mpvController.cyclePlaylist(finalDirection);
  }
  return { finalDirection, finalGeneration, requestCount: 30 };
}

function toggleMainWindowFullscreen(): void {
  const window = currentWindow();
  window.setFullScreen(!window.isFullScreen());
}

function configureDevelopmentMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Playback",
        submenu: [
          {
            accelerator: "PageUp",
            click: () => mpvController?.cyclePlaylist("previous"),
            label: "Previous test channel",
          },
          {
            accelerator: "PageDown",
            click: () => mpvController?.cyclePlaylist("next"),
            label: "Next test channel",
          },
          { type: "separator" },
          {
            accelerator: "F9",
            click: () => {
              try {
                runRapidPlaylistTest();
              } catch {
                // The development action is inert before playback is ready.
              }
            },
            label: "Run 30-change test",
          },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            accelerator: "F11",
            click: () => toggleMainWindowFullscreen(),
            label: "Toggle fullscreen",
          },
        ],
      },
    ]),
  );
}

function registerAcceptanceShortcuts(): void {
  if (process.env.COAX_SLICE3_ACCEPTANCE !== "1") return;
  const shortcuts: ReadonlyArray<readonly [string, () => void]> = [
    ["PageUp", () => void mpvController?.cyclePlaylist("previous")],
    ["PageDown", () => void mpvController?.cyclePlaylist("next")],
    ["F9", () => void runRapidPlaylistTest()],
    ["F11", () => toggleMainWindowFullscreen()],
  ];
  for (const [accelerator, action] of shortcuts) {
    if (!globalShortcut.register(accelerator, action)) {
      playbackLogger?.write("acceptance-shortcut-unavailable", 0, {
        accelerator,
      });
    }
  }
}

function windowState(window: BrowserWindow) {
  return {
    fullscreen: window.isFullScreen(),
    maximized: window.isMaximized(),
    minimized: window.isMinimized(),
  };
}

function recordSettledGeometry(
  window: BrowserWindow,
  reason: GeometryReason,
): void {
  if (window.isDestroyed()) return;
  const flags = windowState(window);
  if (!decideGeometrySynchronization(reason, flags).record) return;
  const bounds = window.getContentBounds();
  alignVideoWindow(window, bounds);
  const display = screen.getDisplayMatching(bounds);
  mpvController?.recordWindowGeometry({
    displayId: display.id,
    height: bounds.height,
    reason,
    scaleFactor: display.scaleFactor,
    state: presentationState(flags),
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
  });
}

function alignVideoWindow(
  window: BrowserWindow,
  bounds = window.getContentBounds(),
): void {
  const host = videoWindow;
  if (
    !host ||
    host.isDestroyed() ||
    !videoPlaybackReady ||
    !window.isVisible() ||
    window.isMinimized()
  ) {
    return;
  }
  host.setBounds(bounds, false);
  if (!host.isVisible()) host.showInactive();
}

function scheduleGeometrySynchronization(
  window: BrowserWindow,
  reason: GeometryReason,
): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) {
    videoWindow?.hide();
  } else {
    alignVideoWindow(window);
  }
  const decision = decideGeometrySynchronization(reason, windowState(window));
  const existing = geometryTimers.get(reason);
  if (existing) clearTimeout(existing);
  geometryTimers.delete(reason);
  if (!decision.record) return;
  if (decision.settleDelayMs === 0) {
    recordSettledGeometry(window, reason);
    return;
  }
  const timer = setTimeout(() => {
    geometryTimers.delete(reason);
    recordSettledGeometry(window, reason);
  }, decision.settleDelayMs);
  geometryTimers.set(reason, timer);
}

function attachWindowLifecycle(window: BrowserWindow): void {
  const events: ReadonlyArray<readonly [string, GeometryReason]> = [
    ["move", "move"],
    ["resize", "resize"],
    ["restore", "restore"],
    ["maximize", "maximize"],
    ["unmaximize", "unmaximize"],
    ["enter-full-screen", "enter-full-screen"],
    ["leave-full-screen", "leave-full-screen"],
  ];
  for (const [event, reason] of events) {
    window.on(event as "resize", () =>
      scheduleGeometrySynchronization(window, reason),
    );
  }
  window.on("minimize", () => videoWindow?.hide());
  window.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.key === "F11" &&
      !input.isAutoRepeat
    ) {
      event.preventDefault();
      toggleMainWindowFullscreen();
      return;
    }
    if (input.type === "keyDown" && input.key === "F9" && !input.isAutoRepeat) {
      event.preventDefault();
      try {
        runRapidPlaylistTest();
      } catch {
        // The development-only acceptance accelerator is inert before playback.
      }
    }
  });
  window.on("close", (event) => {
    if (!shutdownComplete && !shutdownStarted) {
      event.preventDefault();
      app.quit();
    }
  });
  window.on("closed", () => {
    for (const timer of geometryTimers.values()) clearTimeout(timer);
    geometryTimers.clear();
    if (videoWindow && !videoWindow.isDestroyed()) videoWindow.close();
    videoWindow = null;
    if (mainWindow === window) mainWindow = null;
  });
}

function createVideoWindow(parent: BrowserWindow): BaseWindow {
  const bounds = parent.getContentBounds();
  const window = new BaseWindow({
    ...bounds,
    backgroundColor: "#000000",
    focusable: false,
    frame: false,
    hasShadow: false,
    movable: false,
    parent,
    resizable: false,
    roundedCorners: false,
    show: false,
  });
  window.getContentView().setVisible(false);
  window.on("closed", () => {
    if (videoWindow === window) videoWindow = null;
  });
  return window;
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions(join(__dirname, "../preload/index.js")),
  );
  mainWindow = window;
  videoWindow = createVideoWindow(window);
  attachWindowLifecycle(window);

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    window.show();
    alignVideoWindow(window);

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

async function startSlice3Playback(
  window: BrowserWindow,
  nativeVideoHost: BaseWindow,
): Promise<void> {
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
    window.show();
    nativeVideoHost.setBounds(window.getContentBounds(), false);
    nativeVideoHost.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const nativeWindowId = nativeWindowHandleToWid(
      nativeVideoHost.getNativeWindowHandle(),
    );
    const runtime = await loadVerifiedMpvRuntime(applicationRoot);
    playbackLogger.write("mpv-runtime-verified", 1, {
      artifactSha256: runtime.manifest.artifact.sha256,
      architecture: runtime.manifest.target.arch,
      mpvCommit: runtime.manifest.source.mpvCommit,
      ffmpegCommit: runtime.manifest.source.ffmpegCommit,
    });
    mpvController = new MpvController(
      runtime,
      playbackLogger,
      nativeWindowId,
      join(applicationRoot, "scripts", "raise-mpv-child-window.ps1"),
    );
    await mpvController.start(input);
    videoPlaybackReady = true;
    scheduleGeometrySynchronization(window, "ready");
  } catch {
    videoPlaybackReady = false;
    if (!nativeVideoHost.isDestroyed()) nativeVideoHost.hide();
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
  configureDevelopmentMenu();
  registerAcceptanceShortcuts();
  const window = createMainWindow();
  const nativeVideoHost = videoWindow;
  if (!nativeVideoHost) throw new Error("native-video-host-unavailable");
  playbackStartup = startSlice3Playback(window, nativeVideoHost);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("child-process-gone", (_event, details) => {
  if (
    details.type !== "GPU" ||
    details.reason === "clean-exit" ||
    shutdownStarted
  ) {
    return;
  }
  mpvController?.recordGpuProcessLoss(details.reason);
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  setTimeout(() => {
    if (window.isDestroyed()) return;
    window.webContents.reload();
    scheduleGeometrySynchronization(window, "gpu-process-restored");
  }, 250);
});

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (!shutdownStarted) {
    shutdownStarted = true;
    void shutdownOwnedProcesses();
  }
});

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
