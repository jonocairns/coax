import { useEffect, useRef, useState } from "react";
import type { ControllerNavigationAction } from "../../shared/controller-navigation";
import { INITIAL_OVERLAY_STATE, type OverlayState } from "../../shared/overlay";
import {
  INITIAL_STREAM_STATS_SNAPSHOT,
  type StreamStatsState,
} from "../../shared/stream-stats";
import { Icon } from "./Icons";
import { useControllerNavigation } from "./use-controller-navigation";
import { ProviderBrowser } from "./ProviderBrowser";
import { StreamStatsPanel } from "./StreamStatsPanel";

export function OverlayApp(): React.JSX.Element {
  const [state, setState] = useState<OverlayState>({
    ...INITIAL_OVERLAY_STATE,
  });
  const [streamStats, setStreamStats] = useState<StreamStatsState>({
    snapshot: { ...INITIAL_STREAM_STATS_SNAPSHOT },
    visible: false,
  });
  const controls = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    void window.coax.getOverlayState().then(setState);
    return window.coax.onOverlayState(setState);
  }, []);

  useEffect(() => {
    void window.coax.getStreamStatsState().then(setStreamStats);
    return window.coax.onStreamStatsState(setStreamStats);
  }, []);

  useEffect(() => {
    if (!streamStats.visible) return;
    const interval = setInterval(() => {
      void window.coax.getStreamStatsState().then(setStreamStats);
    }, 2_000);
    return () => clearInterval(interval);
  }, [streamStats.visible]);

  useEffect(() => {
    if (state.visible && state.focused) controls.current[1]?.focus();
  }, [state.focused, state.visible]);

  function moveFocus(delta: number): void {
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

  function handleControllerAction(action: ControllerNavigationAction): void {
    if (action === "back") {
      void window.coax.requestOverlayAction("hide");
    } else if (action === "accept") {
      if (document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.click();
      } else {
        controls.current[1]?.focus();
      }
    } else {
      moveFocus(action === "left" || action === "up" ? -1 : 1);
    }
  }

  useControllerNavigation(handleControllerAction);

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    }
  }

  return (
    <main className="overlay-surface" onKeyDown={handleKeyDown}>
      <section
        aria-label="Playback overlay"
        className="overlay-panel"
        data-overlay-interactive
        data-focused={state.focused || undefined}
        onPointerEnter={() => void window.coax.setOverlayPointerCapture(true)}
        onPointerLeave={() => void window.coax.setOverlayPointerCapture(false)}
      >
        {streamStats.visible && (
          <StreamStatsPanel snapshot={streamStats.snapshot} />
        )}
        {(!streamStats.visible || state.focused) && (
          <div className="overlay-main">
            <div className="overlay-copy">
              <div className="overlay-kicker-row">
                <p className="overlay-kicker">Now playing</p>
                <p
                  className={`overlay-feedback phase-${state.phase}`}
                  role="status"
                >
                  <span aria-hidden="true" />
                  {state.feedback}
                </p>
              </div>
              <h1>{state.now}</h1>
              <p className="overlay-next">
                <span>Up next</span>
                {state.next}
              </p>
            </div>
            <div className="overlay-controls" aria-label="Playback controls">
              <button
                aria-label="Previous channel"
                ref={(element) => {
                  controls.current[0] = element;
                }}
                type="button"
                onClick={() => void window.coax.cycleTestChannel("previous")}
              >
                <Icon name="arrow-left" />
                <span>Previous</span>
              </button>
              <button
                aria-label="Next channel"
                className="primary-control"
                ref={(element) => {
                  controls.current[1] = element;
                }}
                type="button"
                onClick={() => void window.coax.cycleTestChannel("next")}
              >
                <Icon name="arrow-right" />
                <span>Next</span>
              </button>
              <button
                aria-label="Close controls"
                ref={(element) => {
                  controls.current[2] = element;
                }}
                type="button"
                onClick={() => void window.coax.requestOverlayAction("hide")}
              >
                <Icon name="close" />
                <span>Close</span>
              </button>
            </div>
          </div>
        )}
        {state.focused && <ProviderBrowser compact />}
      </section>
    </main>
  );
}
