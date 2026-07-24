import { join } from "node:path";
import {
  app,
  BaseWindow,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  powerMonitor,
  safeStorage,
  screen,
} from "electron";
import {
  IPC_CHANNELS,
  type PlaylistIntentResult,
  type RapidPlaylistTestResult,
  type RuntimeVersions,
  type VideoViewport,
  type WindowControlAction,
  type WindowState,
} from "../shared/api";
import {
  INTERNAL_CHANNEL_ID_PATTERN,
  type ChannelPlaybackIntentResult,
  type ProviderFailureKind,
  type ProviderViewState,
  type RapidProviderPlaybackResult,
  type SourceMutationFailureKind,
  type SourceMutationResult,
} from "../shared/provider";
import {
  INITIAL_OVERLAY_STATE,
  reduceOverlayState,
  shouldRevealPlaybackControlsForPointer,
  type OverlayAction,
  type OverlayState,
  type OverlayStateEvent,
  type OverlayView,
} from "../shared/overlay";
import {
  INITIAL_STREAM_STATS_SNAPSHOT,
  type StreamStatsState,
} from "../shared/stream-stats";
import { MpvController, type MpvPlaybackStatusEvent } from "./mpv/controller";
import { extractElectronGpuDiagnostics } from "./electron-gpu";
import { enumerateD3d11Adapters } from "./mpv/hardware-probe";
import {
  resolveMpvPlaybackProfile,
  selectD3d11Adapter,
} from "./mpv/hardware-profile";
import {
  parseSlice8HarnessInput,
  readLocalPlaybackInput,
  readSlice6SyntheticInput,
  readSlice7SyntheticInput,
} from "./mpv/playback-input";
import { loadVerifiedMpvRuntime } from "./mpv/runtime-manifest";
import {
  resolveDeinterlacePolicy,
  resolveSportsFixtureProfile,
} from "./mpv/sports-profile";
import {
  STRUCTURED_LOG_MAX_BYTES,
  STRUCTURED_LOG_RETAINED_FILES,
  StructuredPlaybackLogger,
} from "./mpv/structured-log";
import { nativeWindowHandleToWid } from "./native-window";
import { XtreamUtilityClient } from "./provider/client";
import { XtreamCredentialService } from "./provider/credentials";
import { XtreamProviderSession } from "./provider/session";
import {
  SourceMutationError,
  XtreamSourceManager,
} from "./provider/source-manager";
import { ProviderRequestError } from "./provider/xtream";
import {
  decideGeometrySynchronization,
  presentationState,
  type GeometryReason,
} from "./window-lifecycle";
import { resolvePlaybackBounds } from "./video-viewport";
import {
  createMainWindowOptions,
  createOverlayWindowOptions,
  resolveContentLayerBounds,
} from "./window-options";

if (process.platform === "win32") {
  app.commandLine.appendSwitch("force_high_performance_gpu");
}

let mainWindow: BrowserWindow | null = null;
let videoWindow: BaseWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let videoPlaybackReady = false;
let lastBackAppliedAt = 0;
let playbackLogger: StructuredPlaybackLogger | null = null;
let mpvController: MpvController | null = null;
let providerClient: XtreamUtilityClient | null = null;
let providerSession: XtreamProviderSession | null = null;
let sourceManager: XtreamSourceManager | null = null;
let providerState: ProviderViewState = { phase: "loading" };
let playbackStartup: Promise<void> = Promise.resolve();
let shutdownStarted = false;
let shutdownComplete = false;
const geometryTimers = new Map<GeometryReason, ReturnType<typeof setTimeout>>();
let overlayState: OverlayState = { ...INITIAL_OVERLAY_STATE };
let overlayAutoHideTimer: ReturnType<typeof setTimeout> | null = null;
let overlayFadeTimer: ReturnType<typeof setTimeout> | null = null;
let pointerActivityInterval: ReturnType<typeof setInterval> | null = null;
let streamStatsVisible = false;
let videoPreviewVisible = true;
let videoViewport: VideoViewport | null = null;

const OVERLAY_FADE_DURATION_MS = 220;
const OVERLAY_POINTER_IDLE_MS = 2_400;
const POINTER_ACTIVITY_POLL_MS = 100;

function runtimeVersions(): RuntimeVersions {
  return {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
    slice6Acceptance: process.env.COAX_SLICE6_ACCEPTANCE === "1",
    slice7Acceptance: process.env.COAX_SLICE7_ACCEPTANCE === "1",
  };
}

function currentWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("main-window-unavailable");
  }
  return mainWindow;
}

function currentWindowState(): WindowState {
  const window = currentWindow();
  return {
    fullscreen: window.isFullScreen(),
    maximized: window.isMaximized(),
  };
}

function publishWindowState(fullscreen?: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = currentWindowState();
  const publishedState =
    fullscreen === undefined ? state : { ...state, fullscreen };
  for (const window of [mainWindow, overlayWindow]) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }
    window.webContents.send(IPC_CHANNELS.windowStateChanged, publishedState);
  }
}

function isKnownRenderer(senderId: number): boolean {
  return (
    senderId === mainWindow?.webContents.id ||
    senderId === overlayWindow?.webContents.id
  );
}

function publishOverlayState(): void {
  for (const window of [mainWindow, overlayWindow]) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }
    window.webContents.send(IPC_CHANNELS.overlayStateChanged, overlayState);
  }
}

function publishProviderState(): void {
  for (const window of [mainWindow, overlayWindow]) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }
    window.webContents.send(IPC_CHANNELS.providerStateChanged, providerState);
  }
}

function currentStreamStatsState(): StreamStatsState {
  return {
    snapshot: mpvController?.getStreamStats() ?? {
      ...INITIAL_STREAM_STATS_SNAPSHOT,
    },
    visible: streamStatsVisible,
  };
}

function publishStreamStatsState(): void {
  const state = currentStreamStatsState();
  for (const window of [mainWindow, overlayWindow]) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }
    window.webContents.send(IPC_CHANNELS.streamStatsStateChanged, state);
  }
}

function setProviderState(state: ProviderViewState): void {
  providerState = state;
  publishProviderState();
}

function providerFailure(error: unknown): {
  code: string;
  kind: ProviderFailureKind;
  message: string;
} {
  let kind: ProviderFailureKind = "configuration";
  let code = "provider-configuration-failed";
  if (error instanceof ProviderRequestError) {
    kind = error.kind;
    code = /^[a-z0-9-]{1,64}$/.test(error.code)
      ? error.code
      : "provider-request-failed";
  } else if (
    error instanceof Error &&
    /^[a-z0-9-]{1,64}$/.test(error.message)
  ) {
    code = error.message;
  }
  const message = {
    authentication: "Provider authentication failed.",
    configuration: "Provider configuration is unavailable.",
    "provider-data": "Provider returned an invalid channel response.",
    transport: "Provider could not be reached.",
  }[kind];
  return { code, kind, message };
}

function sourceMutationFailure(error: unknown): {
  code: string;
  kind: SourceMutationFailureKind;
  message: string;
} {
  const kind =
    error instanceof SourceMutationError ? error.kind : "replacement";
  const code =
    error instanceof SourceMutationError && /^[a-z0-9-]{1,64}$/.test(error.code)
      ? error.code
      : "source-operation-failed";
  const message = {
    authentication: "The provider rejected those account details.",
    "provider-data": "The provider returned an invalid channel response.",
    replacement: "The working source could not be replaced.",
    storage: "The source could not be stored securely.",
    transport: "The provider could not be reached.",
    validation: "Check the server address and required account fields.",
  }[kind];
  return { code, kind, message };
}

function transitionOverlayState(event: OverlayStateEvent): void {
  overlayState = reduceOverlayState(overlayState, event);
  publishOverlayState();
}

function clearOverlayAutoHide(): void {
  if (overlayAutoHideTimer) clearTimeout(overlayAutoHideTimer);
  overlayAutoHideTimer = null;
  if (overlayFadeTimer) clearTimeout(overlayFadeTimer);
  overlayFadeTimer = null;
}

function hideOverlay(
  reason: string,
  returnFocus: boolean,
  view: OverlayView = overlayState.view,
): void {
  clearOverlayAutoHide();
  const wasFocused = overlayState.focused;
  transitionOverlayState({ type: "hide", view });
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (streamStatsVisible) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      overlayWindow.showInactive();
      overlayWindow.moveTop();
    } else {
      overlayWindow.hide();
    }
  }
  playbackLogger?.write("overlay-hidden", overlayState.generation, { reason });
  if (returnFocus && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    playbackLogger?.write(
      "overlay-focus-transferred",
      overlayState.generation,
      {
        from: wasFocused ? "overlay" : "overlay-unfocused",
        reason,
        to: "shell",
      },
    );
  }
}

function showOverlay(
  focus: boolean,
  reason: string,
  view: OverlayView = overlayState.view,
): void {
  const shell = mainWindow;
  if (!shell || shell.isDestroyed()) return;
  clearOverlayAutoHide();
  const wasFocused = overlayState.visible && overlayState.focused;
  const focusOverlay = focus || (overlayState.visible && overlayState.focused);
  transitionOverlayState({ focus: focusOverlay, type: "show", view });
  alignNativeLayers(shell);
  const overlay = overlayWindow;
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(!focusOverlay, { forward: !focusOverlay });
  if (focusOverlay) {
    overlay.show();
    overlay.focus();
    if (focus && !wasFocused) {
      playbackLogger?.write(
        "overlay-focus-transferred",
        overlayState.generation,
        {
          from: "shell",
          reason,
          to: "overlay",
        },
      );
    }
  } else {
    overlay.showInactive();
  }
  overlay.moveTop();
  playbackLogger?.write("overlay-shown", overlayState.generation, {
    focusRequested: focus,
    focused: focusOverlay,
    reason,
  });
}

function beginOverlayFade(reason: string): void {
  clearOverlayAutoHide();
  if (
    !overlayState.visible ||
    overlayState.focused ||
    overlayState.view !== "controls" ||
    streamStatsVisible
  ) {
    return;
  }
  transitionOverlayState({ type: "fade" });
  overlayFadeTimer = setTimeout(() => {
    overlayFadeTimer = null;
    if (overlayState.fading) hideOverlay(reason, false, "controls");
  }, OVERLAY_FADE_DURATION_MS);
}

function scheduleFeedbackAutoHide(
  delayMilliseconds = 3_500,
  reason = "feedback-timeout",
): void {
  clearOverlayAutoHide();
  overlayAutoHideTimer = setTimeout(() => {
    overlayAutoHideTimer = null;
    beginOverlayFade(reason);
  }, delayMilliseconds);
}

function isUiAcceptanceRun(): boolean {
  return [3, 4, 5, 6, 7, 8].some(
    (slice) => process.env[`COAX_SLICE${slice}_ACCEPTANCE`] === "1",
  );
}

function startPointerActivityMonitoring(): void {
  if (isUiAcceptanceRun() || pointerActivityInterval) return;
  let previous = screen.getCursorScreenPoint();
  pointerActivityInterval = setInterval(() => {
    const current = screen.getCursorScreenPoint();
    const moved =
      Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) >= 2;
    previous = current;
    if (!moved || !videoPlaybackReady || shutdownStarted) return;

    const shell = mainWindow;
    if (
      !shell ||
      shell.isDestroyed() ||
      !shell.isVisible() ||
      shell.isMinimized()
    ) {
      return;
    }
    const overlayFocused = overlayWindow?.isFocused() ?? false;
    if (!shell.isFocused() && !overlayFocused) return;
    const bounds = shell.getContentBounds();
    if (
      current.x < bounds.x ||
      current.y < bounds.y ||
      current.x >= bounds.x + bounds.width ||
      current.y >= bounds.y + bounds.height
    ) {
      return;
    }
    if (overlayState.view === "browse") return;

    if (shouldRevealPlaybackControlsForPointer(overlayState)) {
      showOverlay(false, "pointer-activity", "controls");
    }
    scheduleFeedbackAutoHide(OVERLAY_POINTER_IDLE_MS, "pointer-inactivity");
  }, POINTER_ACTIVITY_POLL_MS);
}

function stopPointerActivityMonitoring(): void {
  if (pointerActivityInterval) clearInterval(pointerActivityInterval);
  pointerActivityInterval = null;
}

// "back" is the one place Escape (both windows) and controller Back resolve
// fullscreen/controls/browse, instead of three divergent implementations.
//
// Controller ownership already routes each press to a single window, but the
// two windows learn of an ownership change from separate overlay-state
// broadcasts, leaving a sub-frame skew where both could dispatch one press.
// This coalescing window is the belt-and-suspenders guard for that transient:
// wide enough to absorb the two near-simultaneous back dispatches, far below
// the cadence of an intentional double-press so it never drops a real one.
const BACK_COALESCE_WINDOW_MS = 60;

function applyOverlayAction(action: OverlayAction): OverlayState {
  const window = currentWindow();
  let revealsVideo = false;
  if (action === "back") {
    const now = Date.now();
    if (now - lastBackAppliedAt < BACK_COALESCE_WINDOW_MS) {
      return overlayState;
    }
    lastBackAppliedAt = now;
    if (window.isFullScreen()) {
      setMainWindowFullscreen(false);
    } else if (overlayState.view === "controls" && overlayState.visible) {
      hideOverlay("renderer-back", true, "controls");
    } else if (overlayState.view === "controls" && videoPlaybackReady) {
      hideOverlay("renderer-browse", true, "browse");
    } else if (overlayState.view === "browse" && videoPlaybackReady) {
      revealsVideo = true;
      videoViewport = null;
      alignNativeLayers(window);
      hideOverlay("renderer-watch", true, "controls");
    }
  } else if (action === "browse") {
    if (window.isFullScreen()) setMainWindowFullscreen(false);
    hideOverlay("renderer-browse", true, "browse");
  } else if (action === "watch" || action === "fullscreen") {
    revealsVideo = true;
    videoViewport = null;
    // Expand the existing native player while the browser still covers it so
    // revealing player mode never looks like a stream handoff.
    alignNativeLayers(window);
    hideOverlay(`renderer-${action}`, true, "controls");
    if (action === "fullscreen" && !window.isFullScreen()) {
      setMainWindowFullscreen(true);
    }
  } else if (action === "hide") {
    hideOverlay("renderer-back", true, "controls");
  } else if (action === "show") {
    if (overlayState.view === "controls") {
      showOverlay(true, "renderer-show", "controls");
    }
  } else if (overlayState.visible) {
    hideOverlay("renderer-toggle", true, "controls");
  } else if (overlayState.view === "controls") {
    showOverlay(true, "renderer-toggle", "controls");
  }
  alignNativeLayers(window);
  if (revealsVideo || videoViewport === null) {
    scheduleGeometrySynchronization(window, "resize");
  }
  return overlayState;
}

function applyAudioState(volume: number, muted: boolean): OverlayState {
  transitionOverlayState({ muted, type: "audio", volume });
  return overlayState;
}

function setVideoPreviewViewport(viewport: VideoViewport | null): void {
  if (viewport === null) {
    videoViewport = null;
  } else {
    const values = [viewport.x, viewport.y, viewport.width, viewport.height];
    if (
      values.some((value) => !Number.isFinite(value)) ||
      viewport.x < 0 ||
      viewport.y < 0 ||
      viewport.width < 160 ||
      viewport.height < 90
    ) {
      throw new Error("invalid-video-viewport");
    }
    const bounds = currentWindow().getContentBounds();
    videoViewport = {
      height: Math.min(Math.round(viewport.height), bounds.height),
      width: Math.min(Math.round(viewport.width), bounds.width),
      x: Math.min(Math.round(viewport.x), bounds.width - 160),
      y: Math.min(Math.round(viewport.y), bounds.height - 90),
    };
  }
  scheduleGeometrySynchronization(currentWindow(), "resize");
}

function setStreamStatsVisible(visible: boolean): void {
  const leavingPreview =
    visible && overlayState.visible && overlayState.view === "browse";
  if (leavingPreview) {
    videoViewport = null;
    // Statistics are a passive player overlay. Leave the focused browser
    // first so the video expands and the controls do not remain focused over
    // a stale preview-sized viewport.
    hideOverlay("stream-stats-leave-preview", true, "controls");
  }
  streamStatsVisible = visible;
  publishStreamStatsState();
  if (visible) {
    showOverlay(false, "stream-stats-shown", "controls");
    if (leavingPreview) {
      scheduleGeometrySynchronization(currentWindow(), "resize");
    }
  } else if (overlayState.visible && !overlayState.focused) {
    hideOverlay("stream-stats-hidden", false);
  } else if (!overlayState.visible) {
    overlayWindow?.hide();
  }
  playbackLogger?.write("stream-stats-visibility", overlayState.generation, {
    visible,
  });
}

function setOverlayPointerCapture(capture: boolean): void {
  const overlay = overlayWindow;
  if (!overlay || overlay.isDestroyed() || !overlayState.visible) return;
  overlay.setIgnoreMouseEvents(!capture, { forward: !capture });
  playbackLogger?.write("overlay-pointer-mode", overlayState.generation, {
    capture,
  });
}

function requestPlaylistStep(
  direction: "next" | "previous",
): PlaylistIntentResult {
  if (!mpvController) throw new Error("test-playback-not-ready");
  const generation = mpvController.cyclePlaylist(direction);
  transitionOverlayState({ direction, generation, type: "zap" });
  showOverlay(false, "zap-feedback");
  scheduleFeedbackAutoHide();
  return { direction, generation };
}

function providerZapFeedback(channelId: string, generation: number): void {
  transitionOverlayState({
    channelId,
    channelName: providerSession?.channelName(channelId) ?? "Live channel",
    generation,
    type: "channel-zap",
  });
  if (overlayState.view === "controls") {
    showOverlay(false, "provider-channel-feedback");
    scheduleFeedbackAutoHide();
  }
  playbackLogger?.write("provider-channel-requested", generation, {
    channelId,
    transport:
      providerState.phase === "ready"
        ? (providerState.channels.find((channel) => channel.id === channelId)
            ?.transport ?? "unknown")
        : "unknown",
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.configureXtreamSource,
    async (event, input: unknown): Promise<SourceMutationResult> => {
      if (event.sender.id !== mainWindow?.webContents.id) {
        throw new Error("untrusted-renderer");
      }
      const manager = sourceManager;
      if (!manager) {
        return {
          error: {
            code: "source-service-unavailable",
            kind: "replacement",
            message: "Source setup is not ready yet.",
          },
          ok: false,
        };
      }
      try {
        const state = await manager.configure(input);
        setProviderState(state);
        if (state.phase !== "ready") {
          throw new Error("source-ready-state-missing");
        }
        playbackLogger?.write("provider-source-replaced", 0, {
          ...state.counts,
          status: "ready",
        });
        return { ok: true, phase: "ready" };
      } catch (error) {
        const failure = sourceMutationFailure(error);
        playbackLogger?.write("provider-source-replacement-failed", 0, {
          failureKind: failure.kind,
          reason: failure.code,
        });
        return { error: failure, ok: false };
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.getRuntimeVersions, (event): RuntimeVersions => {
    if (!isKnownRenderer(event.sender.id))
      throw new Error("untrusted-renderer");
    return runtimeVersions();
  });
  ipcMain.handle(IPC_CHANNELS.getOverlayState, (event): OverlayState => {
    if (!isKnownRenderer(event.sender.id))
      throw new Error("untrusted-renderer");
    return overlayState;
  });
  ipcMain.handle(IPC_CHANNELS.getProviderState, (event): ProviderViewState => {
    if (!isKnownRenderer(event.sender.id))
      throw new Error("untrusted-renderer");
    return providerState;
  });
  ipcMain.handle(
    IPC_CHANNELS.getStreamStatsState,
    (event): StreamStatsState => {
      if (!isKnownRenderer(event.sender.id))
        throw new Error("untrusted-renderer");
      return currentStreamStatsState();
    },
  );
  ipcMain.handle(IPC_CHANNELS.getWindowState, (event): WindowState => {
    if (!isKnownRenderer(event.sender.id))
      throw new Error("untrusted-renderer");
    return currentWindowState();
  });
  ipcMain.handle(
    IPC_CHANNELS.playProviderChannel,
    async (event, channelId: unknown): Promise<ChannelPlaybackIntentResult> => {
      if (!isKnownRenderer(event.sender.id))
        throw new Error("untrusted-renderer");
      if (
        typeof channelId !== "string" ||
        !INTERNAL_CHANNEL_ID_PATTERN.test(channelId)
      ) {
        throw new Error("invalid-provider-channel-id");
      }
      const session = providerSession;
      if (!session) throw new Error("provider-not-ready");
      try {
        const result = await session.requestPlayback(channelId, (generation) =>
          providerZapFeedback(channelId, generation),
        );
        if (result.accepted) {
          videoPlaybackReady = true;
          const window = currentWindow();
          alignNativeLayers(window);
        }
        return result;
      } catch (error) {
        const failure = providerFailure(error);
        playbackLogger?.write(
          "provider-playback-failed",
          overlayState.generation,
          {
            channelId,
            reason: failure.code,
            failureKind: failure.kind,
          },
        );
        transitionOverlayState({
          feedback: "Channel playback unavailable",
          generation: overlayState.generation,
          type: "recovering",
        });
        showOverlay(false, "provider-channel-failed");
        throw new Error("provider-playback-unavailable", { cause: error });
      }
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.runRapidProviderTest,
    async (event): Promise<RapidProviderPlaybackResult> => {
      if (!isKnownRenderer(event.sender.id))
        throw new Error("untrusted-renderer");
      const session = providerSession;
      if (!session || providerState.phase !== "ready") {
        throw new Error("provider-not-ready");
      }
      const candidates = providerState.channels.slice(0, 2);
      if (candidates.length < 2) {
        throw new Error("provider-channels-insufficient");
      }
      const requests = Array.from({ length: 30 }, (_, index) => {
        const channel = candidates[index % candidates.length];
        if (!channel) throw new Error("provider-channel-unavailable");
        return session.requestPlayback(channel.id, (generation) =>
          providerZapFeedback(channel.id, generation),
        );
      });
      const results = await Promise.all(requests);
      const final = results.at(-1);
      if (!final) throw new Error("provider-rapid-test-empty");
      if (final.accepted) {
        videoPlaybackReady = true;
        alignNativeLayers(currentWindow());
      }
      return {
        acceptedCount: results.filter((result) => result.accepted).length,
        finalChannelId: final.channelId,
        finalGeneration: final.generation,
        requestCount: 30,
      };
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.requestOverlayAction,
    (event, action: unknown): OverlayState => {
      if (!isKnownRenderer(event.sender.id))
        throw new Error("untrusted-renderer");
      if (
        action !== "back" &&
        action !== "browse" &&
        action !== "fullscreen" &&
        action !== "watch" &&
        action !== "hide" &&
        action !== "show" &&
        action !== "toggle"
      ) {
        throw new Error("invalid-overlay-action");
      }
      return applyOverlayAction(action);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.removeXtreamSource,
    async (event): Promise<SourceMutationResult> => {
      if (event.sender.id !== mainWindow?.webContents.id) {
        throw new Error("untrusted-renderer");
      }
      const manager = sourceManager;
      if (!manager) {
        return {
          error: {
            code: "source-service-unavailable",
            kind: "replacement",
            message: "Source removal is not ready yet.",
          },
          ok: false,
        };
      }
      try {
        await manager.remove();
        setProviderState({ phase: "not-configured" });
        try {
          if (mpvController) {
            const generation = mpvController.stopPlayback();
            videoPlaybackReady = false;
            videoViewport = null;
            videoWindow?.hide();
            transitionOverlayState({ generation, type: "stopped" });
          }
        } catch {
          playbackLogger?.write("provider-source-playback-cleanup-failed", 0, {
            reason: "playback-cleanup-failed",
          });
        }
        playbackLogger?.write("provider-source-removed", 0, {
          status: "not-configured",
        });
        return { ok: true, phase: "not-configured" };
      } catch (error) {
        const failure = sourceMutationFailure(error);
        playbackLogger?.write("provider-source-removal-failed", 0, {
          failureKind: failure.kind,
          reason: failure.code,
        });
        return { error: failure, ok: false };
      }
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.setOverlayPointerCapture,
    (event, capture: unknown): void => {
      if (event.sender.id !== overlayWindow?.webContents.id) {
        throw new Error("untrusted-overlay-renderer");
      }
      if (typeof capture !== "boolean") {
        throw new Error("invalid-overlay-pointer-mode");
      }
      setOverlayPointerCapture(capture);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.setVideoPreviewVisible,
    (event, visible: unknown): void => {
      if (event.sender.id !== mainWindow?.webContents.id) {
        throw new Error("untrusted-renderer");
      }
      if (typeof visible !== "boolean") {
        throw new Error("invalid-video-preview-visibility");
      }
      videoPreviewVisible = visible;
      alignNativeLayers(currentWindow());
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.setVideoViewport,
    (event, viewport: unknown): void => {
      if (event.sender.id !== mainWindow?.webContents.id) {
        throw new Error("untrusted-renderer");
      }
      if (
        viewport !== null &&
        (typeof viewport !== "object" || Array.isArray(viewport))
      ) {
        throw new Error("invalid-video-viewport");
      }
      setVideoPreviewViewport(viewport as VideoViewport | null);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.setVolume,
    (event, volume: unknown): OverlayState => {
      if (!isKnownRenderer(event.sender.id))
        throw new Error("untrusted-renderer");
      if (typeof volume !== "number" || !Number.isFinite(volume)) {
        throw new Error("invalid-volume");
      }
      const normalized = Math.min(100, Math.max(0, Math.round(volume)));
      mpvController?.setVolume(normalized);
      return applyAudioState(normalized, overlayState.muted);
    },
  );
  ipcMain.handle(IPC_CHANNELS.stopPlayback, (event): OverlayState => {
    if (!isKnownRenderer(event.sender.id))
      throw new Error("untrusted-renderer");
    const controller = mpvController;
    if (!controller) throw new Error("playback-not-ready");
    const generation = controller.stopPlayback();
    videoPlaybackReady = false;
    videoViewport = null;
    videoWindow?.hide();
    transitionOverlayState({ generation, type: "stopped" });
    applyOverlayAction("browse");
    return overlayState;
  });
  ipcMain.handle(IPC_CHANNELS.toggleMute, (event): OverlayState => {
    if (!isKnownRenderer(event.sender.id))
      throw new Error("untrusted-renderer");
    const muted = !overlayState.muted;
    mpvController?.setMuted(muted);
    return applyAudioState(overlayState.volume, muted);
  });
  ipcMain.handle(
    IPC_CHANNELS.cycleTestChannel,
    (event, direction: unknown): PlaylistIntentResult => {
      if (!isKnownRenderer(event.sender.id))
        throw new Error("untrusted-renderer");
      if (direction !== "next" && direction !== "previous") {
        throw new Error("invalid-test-channel-direction");
      }
      return requestPlaylistStep(direction);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.runRapidPlaylistTest,
    (event): RapidPlaylistTestResult => {
      if (!isKnownRenderer(event.sender.id))
        throw new Error("untrusted-renderer");
      return runRapidPlaylistTest();
    },
  );
  ipcMain.handle(IPC_CHANNELS.toggleFullscreen, (event): boolean => {
    if (!isKnownRenderer(event.sender.id))
      throw new Error("untrusted-renderer");
    return toggleMainWindowFullscreen();
  });
  ipcMain.handle(
    IPC_CHANNELS.windowControl,
    (event, action: unknown): WindowState => {
      if (event.sender.id !== mainWindow?.webContents.id) {
        throw new Error("untrusted-renderer");
      }
      if (
        action !== "close" &&
        action !== "minimize" &&
        action !== "toggle-maximize"
      ) {
        throw new Error("invalid-window-control");
      }
      const control = action as WindowControlAction;
      const window = currentWindow();
      if (control === "close") window.close();
      else if (control === "minimize") window.minimize();
      else if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      return currentWindowState();
    },
  );
}

function runRapidPlaylistTest(): RapidPlaylistTestResult {
  if (!mpvController) throw new Error("test-playback-not-ready");
  let finalDirection: "next" | "previous" = "next";
  let finalGeneration = 0;
  for (let index = 0; index < 30; index += 1) {
    finalDirection = index % 2 === 0 ? "next" : "previous";
    finalGeneration = requestPlaylistStep(finalDirection).generation;
  }
  return { finalDirection, finalGeneration, requestCount: 30 };
}

function toggleMainWindowFullscreen(): boolean {
  const window = currentWindow();
  const fullscreen = !window.isFullScreen();
  return setMainWindowFullscreen(fullscreen);
}

function setMainWindowFullscreen(fullscreen: boolean): boolean {
  const window = currentWindow();
  window.setFullScreen(fullscreen);
  // Electron's fullscreen transition is asynchronous on Windows. Publish the
  // requested state now so the renderer does not briefly retain the old title
  // bar layout while the native playback layers are already being restored.
  publishWindowState(fullscreen);
  return fullscreen;
}

function attachApplicationContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", () => {
    Menu.buildFromTemplate([
      {
        checked: streamStatsVisible,
        click: (menuItem) => setStreamStatsVisible(menuItem.checked),
        label: "Stream statistics",
        type: "checkbox",
      },
    ]).popup({ window });
  });
}

function registerAcceptanceShortcuts(): void {
  if (
    process.env.COAX_SLICE3_ACCEPTANCE !== "1" &&
    process.env.COAX_SLICE4_ACCEPTANCE !== "1"
  ) {
    return;
  }
  const shortcuts: ReadonlyArray<readonly [string, () => void]> = [
    [
      "PageUp",
      () => {
        try {
          requestPlaylistStep("previous");
        } catch {
          // Playback is not ready yet.
        }
      },
    ],
    [
      "PageDown",
      () => {
        try {
          requestPlaylistStep("next");
        } catch {
          // Playback is not ready yet.
        }
      },
    ],
    ["F9", () => void runRapidPlaylistTest()],
    ["F11", () => toggleMainWindowFullscreen()],
    ["F8", () => void applyOverlayAction("toggle")],
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
  const layerBounds = resolveContentLayerBounds(bounds, flags.fullscreen);
  alignNativeLayers(window, bounds);
  const playbackBounds = resolvePlaybackBounds(
    bounds,
    layerBounds,
    videoViewport,
  );
  const display = screen.getDisplayMatching(playbackBounds);
  mpvController?.recordWindowGeometry({
    displayId: display.id,
    height: playbackBounds.height,
    reason,
    scaleFactor: display.scaleFactor,
    state: presentationState(flags),
    width: playbackBounds.width,
    x: playbackBounds.x,
    y: playbackBounds.y,
  });
  playbackLogger?.write(
    "overlay-geometry-synchronized",
    overlayState.generation,
    {
      displayId: display.id,
      height: layerBounds.height,
      reason,
      scaleFactor: display.scaleFactor,
      state: presentationState(flags),
      width: layerBounds.width,
      x: layerBounds.x,
      y: layerBounds.y,
    },
  );
}

function alignNativeLayers(
  window: BrowserWindow,
  bounds = window.getContentBounds(),
): void {
  const layerBounds = resolveContentLayerBounds(bounds, window.isFullScreen());
  const host = videoWindow;
  if (!window.isVisible() || window.isMinimized()) return;
  if (
    host &&
    !host.isDestroyed() &&
    videoPlaybackReady &&
    videoPreviewVisible
  ) {
    host.setBounds(
      resolvePlaybackBounds(bounds, layerBounds, videoViewport),
      false,
    );
    if (!host.isVisible()) host.showInactive();
  } else if (host && !host.isDestroyed() && host.isVisible()) {
    host.hide();
  }
  const overlay = overlayWindow;
  if (overlay && !overlay.isDestroyed()) {
    overlay.setBounds(layerBounds, false);
    if (overlayState.visible && !overlay.isVisible()) {
      if (overlayState.focused) overlay.show();
      else overlay.showInactive();
    }
    if (overlayState.visible) overlay.moveTop();
  }
}

function scheduleGeometrySynchronization(
  window: BrowserWindow,
  reason: GeometryReason,
): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) {
    videoWindow?.hide();
    overlayWindow?.hide();
  } else {
    alignNativeLayers(window);
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
    window.on(event as "resize", () => {
      scheduleGeometrySynchronization(window, reason);
      if (
        reason === "maximize" ||
        reason === "unmaximize" ||
        reason === "enter-full-screen" ||
        reason === "leave-full-screen"
      ) {
        publishWindowState(
          reason === "enter-full-screen"
            ? true
            : reason === "leave-full-screen"
              ? false
              : undefined,
        );
      }
    });
  }
  window.on("minimize", () => {
    videoWindow?.hide();
    overlayWindow?.hide();
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.key === "Escape" &&
      !input.isAutoRepeat
    ) {
      event.preventDefault();
      applyOverlayAction("back");
      return;
    }
    if (
      input.type === "keyDown" &&
      input.key === "F11" &&
      !input.isAutoRepeat
    ) {
      event.preventDefault();
      toggleMainWindowFullscreen();
      return;
    }
    if (
      input.type === "keyDown" &&
      input.key === "F8" &&
      !input.isAutoRepeat &&
      overlayState.view === "controls"
    ) {
      event.preventDefault();
      applyOverlayAction("toggle");
      return;
    }
    if (
      input.type === "keyDown" &&
      input.key === "Enter" &&
      !input.isAutoRepeat &&
      !overlayState.visible &&
      overlayState.view === "controls"
    ) {
      event.preventDefault();
      showOverlay(true, "keyboard-enter");
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
    clearOverlayAutoHide();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
    overlayWindow = null;
    if (videoWindow && !videoWindow.isDestroyed()) videoWindow.close();
    videoWindow = null;
    if (mainWindow === window) mainWindow = null;
  });
}

function secureLocalRenderer(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

function loadRendererSurface(
  window: BrowserWindow,
  surface: "overlay" | "shell",
): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    rendererUrl.searchParams.set("surface", surface);
    void window.loadURL(rendererUrl.toString());
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { surface },
    });
  }
}

function createVideoWindow(parent: BrowserWindow): BaseWindow {
  const bounds = resolveContentLayerBounds(
    parent.getContentBounds(),
    parent.isFullScreen(),
  );
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
    thickFrame: false,
  });
  // Playback is display-only; pointer input belongs to the shell/overlay so
  // the application context menu remains available over the video surface.
  window.setIgnoreMouseEvents(true, { forward: true });
  window.getContentView().setVisible(false);
  window.on("closed", () => {
    if (videoWindow === window) videoWindow = null;
  });
  return window;
}

function createOverlayWindow(parent: BrowserWindow): BrowserWindow {
  const window = new BrowserWindow({
    ...createOverlayWindowOptions(join(__dirname, "../preload/index.js")),
    ...resolveContentLayerBounds(
      parent.getContentBounds(),
      parent.isFullScreen(),
    ),
    parent,
  });
  secureLocalRenderer(window);
  attachApplicationContextMenu(window);
  window.setIgnoreMouseEvents(true, { forward: true });
  window.webContents.on("did-finish-load", () => publishOverlayState());
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat) return;
    if (input.key === "Escape") {
      event.preventDefault();
      applyOverlayAction("back");
    } else if (input.key === "F8") {
      event.preventDefault();
      applyOverlayAction("toggle");
    } else if (input.key === "F11") {
      event.preventDefault();
      toggleMainWindowFullscreen();
    }
  });
  window.on("closed", () => {
    if (overlayWindow === window) overlayWindow = null;
  });
  loadRendererSurface(window, "overlay");
  return window;
}

function configureControlledAcceptance(window: BrowserWindow): void {
  const slice6 = process.env.COAX_SLICE6_ACCEPTANCE === "1";
  const slice7 = process.env.COAX_SLICE7_ACCEPTANCE === "1";
  const slice8 = process.env.COAX_SLICE8_ACCEPTANCE === "1";
  if (!slice6 && !slice7 && !slice8) return;
  transitionOverlayState({ type: "hide", view: "controls" });
  if (
    process.env.COAX_SLICE6_FULLSCREEN === "1" ||
    process.env.COAX_SLICE7_FULLSCREEN === "1" ||
    process.env.COAX_SLICE8_FULLSCREEN === "1"
  ) {
    window.setFullScreen(true);
  }
  if (slice6 && process.env.COAX_SLICE6_VIEWPORT_CYCLE === "1") {
    setTimeout(() => {
      if (window.isDestroyed()) return;
      window.setFullScreen(false);
      window.setSize(1280, 720);
      window.center();
    }, 5_000);
    setTimeout(() => {
      if (window.isDestroyed()) return;
      window.setSize(960, 540);
      window.center();
    }, 10_000);
    setTimeout(() => {
      if (!window.isDestroyed()) window.setFullScreen(true);
    }, 15_000);
  }
  const rawAutoExit = slice8
    ? process.env.COAX_SLICE8_AUTO_EXIT_SECONDS
    : slice7
      ? process.env.COAX_SLICE7_AUTO_EXIT_SECONDS
      : process.env.COAX_SLICE6_AUTO_EXIT_SECONDS;
  if (rawAutoExit && /^\d{1,4}$/.test(rawAutoExit)) {
    const seconds = Number(rawAutoExit);
    if (seconds >= 5 && seconds <= 2_000) {
      setTimeout(() => app.quit(), seconds * 1_000);
    }
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions(join(__dirname, "../preload/index.js")),
  );
  mainWindow = window;
  window.removeMenu();
  videoWindow = createVideoWindow(window);
  overlayWindow = createOverlayWindow(window);
  attachWindowLifecycle(window);

  secureLocalRenderer(window);
  attachApplicationContextMenu(window);
  window.once("ready-to-show", () => {
    window.show();
    configureControlledAcceptance(window);
    alignNativeLayers(window);

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

  loadRendererSurface(window, "shell");

  return window;
}

function handleMpvPlaybackStatus(event: MpvPlaybackStatusEvent): void {
  if (event.kind === "playing") {
    transitionOverlayState({ generation: event.generation, type: "playing" });
    if (overlayState.visible && !overlayState.focused)
      scheduleFeedbackAutoHide();
    return;
  }
  const feedback =
    event.reason === "cache-paused"
      ? "Buffering playback"
      : event.reason === "ipc-heartbeat-timeout"
        ? "Playback unresponsive · reconnecting"
        : "Reconnecting playback";
  transitionOverlayState({
    feedback,
    generation: event.generation,
    type: "recovering",
  });
  if (overlayState.view === "controls") {
    showOverlay(false, `recovery-${event.reason}`);
  }
}

function restoreOverlayAfterMpvStacking(): void {
  const shell = mainWindow;
  if (!shell || shell.isDestroyed()) return;
  alignNativeLayers(shell);
}

async function startM0Playback(
  window: BrowserWindow,
  nativeVideoHost: BaseWindow,
): Promise<void> {
  if (process.platform !== "win32" || process.env.COAX_SMOKE_TEST === "1") {
    return;
  }

  const applicationRoot = app.getAppPath();
  playbackLogger = new StructuredPlaybackLogger(applicationRoot);
  playbackLogger.write("diagnostic-session-started", 0, {
    logMaxBytes: STRUCTURED_LOG_MAX_BYTES,
    logRetainedFiles: STRUCTURED_LOG_RETAINED_FILES,
    schemaVersion: 1,
  });
  const slice6Acceptance = process.env.COAX_SLICE6_ACCEPTANCE === "1";
  const slice7Acceptance = process.env.COAX_SLICE7_ACCEPTANCE === "1";
  const slice8Acceptance = process.env.COAX_SLICE8_ACCEPTANCE === "1";
  const controlledAcceptance =
    slice6Acceptance || slice7Acceptance || slice8Acceptance;
  let syntheticInput = null;
  if (slice6Acceptance) {
    try {
      syntheticInput = await readSlice6SyntheticInput(
        applicationRoot,
        process.env.COAX_SLICE6_FIXTURE_NAME,
      );
      playbackLogger.write("slice6-synthetic-input", 0, {
        configured: syntheticInput !== null,
      });
    } catch {
      playbackLogger.write("slice6-synthetic-input", 0, {
        configured: false,
        reason: "invalid-synthetic-input",
      });
      throw new Error("invalid-slice6-synthetic-input");
    }
  } else if (slice7Acceptance) {
    try {
      syntheticInput = await readSlice7SyntheticInput(
        applicationRoot,
        process.env.COAX_SLICE7_FIXTURE_NAME,
      );
      playbackLogger.write("slice7-synthetic-input", 0, {
        configured: syntheticInput !== null,
      });
    } catch {
      playbackLogger.write("slice7-synthetic-input", 0, {
        configured: false,
        reason: "invalid-synthetic-input",
      });
      throw new Error("invalid-slice7-synthetic-input");
    }
  } else if (slice8Acceptance) {
    try {
      syntheticInput = parseSlice8HarnessInput(
        process.env.COAX_SLICE8_PLAYER_URL,
        process.env.COAX_SLICE8_FIXTURE_ID,
      );
      playbackLogger.write("slice8-harness-input", 0, {
        configured: syntheticInput !== null,
        fixtureId: process.env.COAX_SLICE8_FIXTURE_ID ?? "missing",
      });
    } catch {
      playbackLogger.write("slice8-harness-input", 0, {
        configured: false,
        reason: "invalid-harness-input",
      });
      throw new Error("invalid-slice8-harness-input");
    }
  }
  const credentials = new XtreamCredentialService(
    safeStorage,
    applicationRoot,
    app.getPath("userData"),
  );
  let credentialStatus: "available" | "missing" = "missing";
  if (!controlledAcceptance) {
    try {
      const result = await credentials.initialize();
      credentialStatus = result.status;
      playbackLogger.write("provider-credentials-initialized", 0, {
        imported: result.imported,
        status: result.status,
      });
    } catch (error) {
      const failure = providerFailure(error);
      setProviderState({ error: failure, phase: "error" });
      playbackLogger.write("provider-credentials-failed", 0, {
        failureKind: failure.kind,
        reason: failure.code,
      });
    }
  } else {
    setProviderState({ phase: "not-configured" });
  }

  let input = syntheticInput;
  try {
    if (!controlledAcceptance && credentialStatus === "missing") {
      input = await readLocalPlaybackInput(applicationRoot);
    }
  } catch {
    playbackLogger.write("playback-startup-failed", 0, {
      reason: "invalid-local-input",
    });
  }
  if (!controlledAcceptance && credentialStatus === "missing") {
    if (!input) {
      playbackLogger.write("playback-input-missing", 0, {
        reason: "local-input-not-configured",
      });
    }
  }
  try {
    window.show();
    nativeVideoHost.setBounds(window.getContentBounds(), false);
    if (input) nativeVideoHost.showInactive();
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
    try {
      const gpu = extractElectronGpuDiagnostics(
        await app.getGPUInfo("complete"),
      );
      playbackLogger.write("electron-gpu-diagnostics", 0, {
        activeGpu: gpu.activeGpu,
        driverVersion: gpu.driverVersion,
        hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(),
        videoDecodeFeature:
          app.getGPUFeatureStatus().video_decode ?? "unavailable",
      });
    } catch {
      playbackLogger.write("electron-gpu-diagnostics", 0, {
        activeGpu: "unavailable",
        driverVersion: "unavailable",
        hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(),
        videoDecodeFeature: "unavailable",
      });
    }
    const adapters = await enumerateD3d11Adapters(runtime.executablePath);
    const adapterSelection = selectD3d11Adapter(adapters);
    for (const adapter of adapters) {
      playbackLogger.write("mpv-d3d11-adapter-enumerated", 0, {
        adapterDescription: adapter.description,
        adapterIndex: adapter.index,
        defaultAdapter: adapter.index === 0,
        vendorId: adapter.vendorId,
      });
    }
    const profile = resolveMpvPlaybackProfile(
      process.env.COAX_M0_PLAYBACK_PROFILE,
    );
    const deinterlacePolicy = resolveDeinterlacePolicy(
      process.env.COAX_M0_FIELD_ORDER_OVERRIDE,
      slice7Acceptance &&
        process.env.COAX_SLICE7_FORCE_DEINTERLACE_FAILURE === "1",
      !slice6Acceptance,
    );
    const sportsFixture = slice7Acceptance
      ? resolveSportsFixtureProfile(process.env.COAX_SLICE7_FIXTURE_NAME)
      : null;
    playbackLogger.write("mpv-profile-selected", 0, {
      adapter: adapterSelection.adapter.description,
      adapterDefault: adapterSelection.defaultAdapter.description,
      adapterExplicit: adapterSelection.explicit,
      adapterSelectionReason: adapterSelection.reason,
      fallbackScaler: profile.fallbackScaler,
      deinterlaceFieldOrder: deinterlacePolicy.fieldOrder,
      deinterlaceInterlacedOnly: deinterlacePolicy.interlacedOnly,
      deinterlaceMode: deinterlacePolicy.mode,
      gpuApi: "d3d11",
      gpuContext: "d3d11",
      hwdecRequested: profile.hwdec,
      profile: profile.name,
      renderVo: "gpu-next",
      vsrPolicyEnabled: profile.requestVsr,
    });
    mpvController = new MpvController(
      runtime,
      playbackLogger,
      nativeWindowId,
      join(applicationRoot, "scripts", "raise-mpv-child-window.ps1"),
      profile,
      adapterSelection,
      deinterlacePolicy,
      sportsFixture,
      handleMpvPlaybackStatus,
      restoreOverlayAfterMpvStacking,
    );
    await mpvController.start(input ?? undefined);
    videoPlaybackReady = input !== null;
    if (videoPlaybackReady) scheduleGeometrySynchronization(window, "ready");
    if (!controlledAcceptance) {
      providerClient = new XtreamUtilityClient(
        join(__dirname, "provider-worker.js"),
      );
      providerSession = new XtreamProviderSession(
        credentials,
        providerClient,
        mpvController,
      );
      sourceManager = new XtreamSourceManager(
        credentials,
        providerClient,
        providerSession,
      );
      if (credentialStatus === "available") {
        try {
          providerSession.setSourceName(await credentials.loadName());
          setProviderState(await providerSession.refresh());
          if (providerState.phase === "ready") {
            playbackLogger.write("provider-catalog-loaded", 0, {
              ...providerState.counts,
              hlsVariants: providerState.channels.filter(
                (channel) => channel.transport === "hls",
              ).length,
              mpegTsVariants: providerState.channels.filter(
                (channel) => channel.transport === "mpeg-ts",
              ).length,
            });
          }
        } catch (error) {
          const failure = providerFailure(error);
          setProviderState({ error: failure, phase: "error" });
          playbackLogger.write("provider-catalog-failed", 0, {
            failureKind: failure.kind,
            reason: failure.code,
          });
        }
      } else if (providerState.phase !== "error") {
        setProviderState({ phase: "not-configured" });
      }
    }
  } catch {
    videoPlaybackReady = false;
    transitionOverlayState({ type: "unavailable" });
    if (!nativeVideoHost.isDestroyed()) nativeVideoHost.hide();
    playbackLogger.write("playback-startup-failed", 1, {
      reason: "runtime-or-mpv-startup-failure",
    });
  }
}

async function shutdownOwnedProcesses(): Promise<void> {
  try {
    await playbackStartup;
    providerClient?.close();
    providerClient = null;
    sourceManager = null;
    await mpvController?.shutdown();
    await playbackLogger?.close();
  } finally {
    shutdownComplete = true;
    app.quit();
  }
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  Menu.setApplicationMenu(null);
  registerAcceptanceShortcuts();
  const window = createMainWindow();
  const nativeVideoHost = videoWindow;
  if (!nativeVideoHost) throw new Error("native-video-host-unavailable");
  playbackStartup = startM0Playback(window, nativeVideoHost);
  startPointerActivityMonitoring();

  powerMonitor.on("resume", () => {
    const current = mainWindow;
    if (!current || current.isDestroyed()) return;
    transitionOverlayState({
      feedback: "Resuming playback",
      generation: overlayState.generation,
      type: "recovering",
    });
    showOverlay(false, "display-resume");
    scheduleGeometrySynchronization(current, "restore");
  });
  screen.on("display-metrics-changed", () => {
    const current = mainWindow;
    if (current && !current.isDestroyed()) {
      scheduleGeometrySynchronization(current, "resize");
    }
  });

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
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.reload();
    }
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

app.on("will-quit", () => {
  stopPointerActivityMonitoring();
  clearOverlayAutoHide();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
