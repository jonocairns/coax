import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Square, Tv } from "lucide-react";
import type { ControllerNavigationAction } from "../../shared/controller-navigation";
import { INITIAL_OVERLAY_STATE, type OverlayState } from "../../shared/overlay";
import {
  INITIAL_STREAM_STATS_SNAPSHOT,
  type StreamStatsState,
} from "../../shared/stream-stats";
import { StatusIndicator } from "./components/StatusIndicator";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
import { ProviderBrowser } from "./ProviderBrowser";
import { StreamStatsPanel } from "./StreamStatsPanel";
import { useControllerNavigation } from "./use-controller-navigation";
import { VolumeControl } from "./VolumeControl";

export function OverlayApp(): React.JSX.Element {
  const [state, setState] = useState<OverlayState>({
    ...INITIAL_OVERLAY_STATE,
  });
  const [streamStats, setStreamStats] = useState<StreamStatsState>({
    snapshot: { ...INITIAL_STREAM_STATS_SNAPSHOT },
    visible: false,
  });
  const [hasPlayback, setHasPlayback] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const controls = useRef<Array<HTMLButtonElement | null>>([]);
  const preview = useRef<HTMLDivElement | null>(null);
  const browsing = state.visible && state.focused && state.view === "browse";
  const showingControls = state.visible && state.view === "controls";

  useEffect(() => {
    void window.coax.getOverlayState().then(setState);
    return window.coax.onOverlayState(setState);
  }, []);

  useEffect(() => {
    void window.coax.getStreamStatsState().then(setStreamStats);
    return window.coax.onStreamStatsState(setStreamStats);
  }, []);

  useEffect(() => {
    void window.coax
      .getWindowState()
      .then((windowState) => setFullscreen(windowState.fullscreen));
    return window.coax.onWindowState((windowState) =>
      setFullscreen(windowState.fullscreen),
    );
  }, []);

  useEffect(() => {
    if (!streamStats.visible) return;
    const interval = setInterval(() => {
      void window.coax.getStreamStatsState().then(setStreamStats);
    }, 2_000);
    return () => clearInterval(interval);
  }, [streamStats.visible]);

  useEffect(() => {
    if (showingControls && state.focused) {
      controls.current.find((control) => control !== null)?.focus();
    }
  }, [fullscreen, showingControls, state.focused]);

  useEffect(() => {
    if (!state.channelId) setHasPlayback(false);
    else if (state.phase === "playing") setHasPlayback(true);
  }, [state.channelId, state.phase]);

  useEffect(() => {
    const element = preview.current;
    if (!browsing || !element) return;
    let animationFrame = 0;
    const publishBounds = (): void => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        void window.coax.setVideoViewport({
          height: Math.round(bounds.height),
          width: Math.round(bounds.width),
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
        });
      });
    };
    const observer = new ResizeObserver(publishBounds);
    observer.observe(element);
    publishBounds();
    window.addEventListener("resize", publishBounds);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", publishBounds);
    };
  }, [browsing]);

  function moveControlFocus(delta: number): void {
    const available = controls.current.filter(
      (control): control is HTMLButtonElement => control !== null,
    );
    if (available.length === 0) return;
    const current = available.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const next =
      (Math.max(current, 0) + delta + available.length) % available.length;
    available[next]?.focus();
  }

  function focusFirstControl(): void {
    controls.current.find((control) => control !== null)?.focus();
  }

  function handleControllerAction(action: ControllerNavigationAction): void {
    if (!showingControls) return;
    if (action === "back") {
      void window.coax.requestOverlayAction("hide");
    } else if (action === "accept") {
      if (document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.click();
      } else {
        focusFirstControl();
      }
    } else {
      moveControlFocus(action === "left" || action === "up" ? -1 : 1);
    }
  }

  useControllerNavigation(handleControllerAction);

  return (
    <>
      <main
        className="grid h-screen w-screen grid-cols-[minmax(0,1.08fr)_minmax(15rem,.92fr)] overflow-hidden bg-transparent pointer-events-auto min-[721px]:grid-cols-[minmax(0,1.18fr)_minmax(17rem,.82fr)]"
        hidden={!browsing}
      >
        <section
          className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] bg-background"
          aria-label="Channel browser"
          onPointerEnter={() => void window.coax.setOverlayPointerCapture(true)}
          onPointerLeave={() =>
            void window.coax.setOverlayPointerCapture(false)
          }
        >
          <ProviderBrowser
            activeChannelId={state.channelId}
            compact
            playbackFeedback={state.feedback}
            playbackPhase={state.phase}
          />
        </section>

        <aside
          className={cn(
            "grid min-h-0 min-w-0 grid-rows-[minmax(12rem,1fr)_auto]",
            hasPlayback ? "bg-transparent" : "bg-card",
          )}
          aria-label="Live preview"
        >
          <div
            aria-label="Live video preview"
            className={cn(
              "relative isolate grid min-h-0 w-full place-items-center overflow-hidden text-foreground",
              hasPlayback ? "bg-transparent" : "bg-card",
            )}
            ref={preview}
          >
            {!hasPlayback && (
              <span className="relative z-10 grid place-items-center text-foreground/85 before:absolute before:-z-10 before:h-72 before:w-96 before:rounded-full before:bg-foreground before:opacity-[0.04] before:blur-3xl before:content-['']">
                <span className="grid size-16 place-items-center rounded-2xl border bg-secondary text-foreground shadow-sm">
                  <Tv />
                </span>
                <strong className="mt-5 text-base font-semibold tracking-tight">
                  {state.channelId
                    ? "Starting your channel…"
                    : "Your live preview"}
                </strong>
                <small className="mt-2 text-sm text-muted-foreground">
                  {state.channelId
                    ? "Playback will appear here when it is ready."
                    : "Choose a channel to start watching."}
                </small>
              </span>
            )}
          </div>

          <section
            className="bg-card p-[clamp(0.9rem,1.6vw,1.2rem)] max-[720px]:p-3.5"
            onPointerEnter={() =>
              void window.coax.setOverlayPointerCapture(true)
            }
            onPointerLeave={() =>
              void window.coax.setOverlayPointerCapture(false)
            }
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-[0.68rem] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
                  Now playing
                </p>
                <h1 className="mb-2 max-w-88 truncate text-[clamp(1.25rem,2.2vw,1.8rem)] font-semibold tracking-[-0.04em]">
                  {state.channelId ? state.now : "Nothing selected"}
                </h1>
              </div>
              <StatusIndicator
                className="mt-1 shrink-0 max-[720px]:hidden"
                tone={
                  state.phase === "zapping" || state.phase === "recovering"
                    ? "warning"
                    : state.phase === "unavailable"
                      ? "destructive"
                      : "default"
                }
              >
                {state.feedback}
              </StatusIndicator>
            </div>
            <VolumeControl state={state} />
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2.5">
              <Button
                disabled={!hasPlayback}
                className="w-full disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100 dark:disabled:bg-secondary dark:disabled:text-muted-foreground"
                onClick={() =>
                  void window.coax.requestOverlayAction("fullscreen")
                }
                size="lg"
                type="button"
              >
                <Maximize2 />
                Fullscreen
              </Button>
              <Button
                aria-label="Stop playback"
                className="disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100 dark:disabled:bg-secondary dark:disabled:text-muted-foreground"
                disabled={!state.channelId}
                onClick={() => void window.coax.stopPlayback()}
                size="icon-lg"
                title="Stop playback"
                type="button"
                variant="destructive"
              >
                <Square />
              </Button>
            </div>
          </section>
        </aside>
      </main>

      <main
        className={cn(
          "flex min-h-screen items-end bg-transparent p-[clamp(1.25rem,3.5vw,3.25rem)] opacity-100 transition-[opacity,transform] duration-200 pointer-events-none max-[720px]:p-3.5",
          state.fading && "translate-y-1.5 opacity-0",
        )}
        hidden={!showingControls}
      >
        <section
          aria-label="Playback overlay"
          className="grid w-full gap-4 pointer-events-auto"
          data-overlay-interactive
          data-focused={state.focused || undefined}
          onPointerEnter={() => void window.coax.setOverlayPointerCapture(true)}
          onPointerLeave={() =>
            void window.coax.setOverlayPointerCapture(false)
          }
        >
          {streamStats.visible && (
            <StreamStatsPanel snapshot={streamStats.snapshot} />
          )}
          {(!streamStats.visible || state.focused) && (
            <div className="flex min-w-0 items-end justify-between gap-8 rounded-xl border bg-background/95 p-[clamp(1.1rem,2.2vw,1.65rem)] shadow-2xl backdrop-blur-md max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-4">
                  <p className="mb-2 text-[0.68rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                    Now playing
                  </p>
                  <StatusIndicator
                    className="mb-2 max-[720px]:hidden"
                    tone={
                      state.phase === "zapping" || state.phase === "recovering"
                        ? "warning"
                        : state.phase === "unavailable"
                          ? "destructive"
                          : "default"
                    }
                  >
                    {state.feedback}
                  </StatusIndicator>
                </div>
                <h1 className="mb-3 max-w-2xl truncate text-[clamp(1.8rem,3.4vw,3.15rem)] leading-none font-semibold tracking-[-0.045em]">
                  {state.now}
                </h1>
              </div>
              <div className="flex shrink-0 items-center gap-4 max-[720px]:flex-col max-[720px]:items-end">
                <VolumeControl compact state={state} />
                <div
                  className="flex shrink-0 gap-2.5"
                  aria-label="Playback controls"
                >
                  {fullscreen && (
                    <Button
                      aria-label="Exit fullscreen"
                      ref={(element) => {
                        controls.current[0] = element;
                      }}
                      type="button"
                      size="icon-lg"
                      title="Exit fullscreen"
                      variant="secondary"
                      onClick={() => void window.coax.toggleFullscreen()}
                    >
                      <Minimize2 />
                      <span className="sr-only">Exit fullscreen</span>
                    </Button>
                  )}
                  {!fullscreen && (
                    <Button
                      aria-label="Stop playback"
                      className="text-destructive hover:text-destructive"
                      ref={(element) => {
                        controls.current[1] = element;
                      }}
                      type="button"
                      size="icon-lg"
                      variant="secondary"
                      onClick={() => void window.coax.stopPlayback()}
                    >
                      <Square />
                      <span className="sr-only">Stop</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
