import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Square } from "lucide-react";
import type { ControllerNavigationAction } from "../../shared/controller-navigation";
import { INITIAL_OVERLAY_STATE, type OverlayState } from "../../shared/overlay";
import {
  INITIAL_STREAM_STATS_SNAPSHOT,
  type StreamStatsState,
} from "../../shared/stream-stats";
import { StatusIndicator } from "./components/StatusIndicator";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
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
  const [fullscreen, setFullscreen] = useState(false);
  const controls = useRef<Array<HTMLButtonElement | null>>([]);
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
        onPointerLeave={() => void window.coax.setOverlayPointerCapture(false)}
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
                <Button
                  aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                  ref={(element) => {
                    controls.current[0] = element;
                  }}
                  type="button"
                  size="icon-lg"
                  title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                  variant="secondary"
                  onClick={() => void window.coax.toggleFullscreen()}
                >
                  {fullscreen ? <Minimize2 /> : <Maximize2 />}
                  <span className="sr-only">
                    {fullscreen ? "Exit fullscreen" : "Fullscreen"}
                  </span>
                </Button>
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
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
