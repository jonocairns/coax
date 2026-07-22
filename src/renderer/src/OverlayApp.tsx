import { useEffect, useRef, useState } from "react";
import type { ControllerNavigationAction } from "../../shared/controller-navigation";
import { INITIAL_OVERLAY_STATE, type OverlayState } from "../../shared/overlay";
import {
  INITIAL_STREAM_STATS_SNAPSHOT,
  type StreamStatsState,
} from "../../shared/stream-stats";
import { Icon } from "./Icons";
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
  const controls = useRef<Array<HTMLButtonElement | null>>([]);
  const preview = useRef<HTMLButtonElement | null>(null);
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
    if (!streamStats.visible) return;
    const interval = setInterval(() => {
      void window.coax.getStreamStatsState().then(setStreamStats);
    }, 2_000);
    return () => clearInterval(interval);
  }, [streamStats.visible]);

  useEffect(() => {
    if (showingControls && state.focused) controls.current[1]?.focus();
  }, [showingControls, state.focused]);

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

  function handleControllerAction(action: ControllerNavigationAction): void {
    if (!showingControls) return;
    if (action === "back") {
      void window.coax.requestOverlayAction("hide");
    } else if (action === "accept") {
      if (document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.click();
      } else {
        controls.current[1]?.focus();
      }
    } else {
      moveControlFocus(action === "left" || action === "up" ? -1 : 1);
    }
  }

  useControllerNavigation(handleControllerAction);

  return (
    <>
      <main
        className="browse-surface"
        hidden={!browsing}
        onPointerEnter={() => void window.coax.setOverlayPointerCapture(true)}
        onPointerLeave={() => void window.coax.setOverlayPointerCapture(false)}
      >
        <section className="browse-catalog" aria-label="Channel browser">
          <ProviderBrowser
            activeChannelId={state.channelId}
            compact
            playbackFeedback={state.feedback}
            playbackPhase={state.phase}
          />
        </section>

        <aside className="browse-player" aria-label="Live preview">
          <button
            aria-label={
              hasPlayback
                ? `Watch ${state.now} fullscreen`
                : "Choose a channel to start playback"
            }
            className={`video-preview${hasPlayback ? " has-video" : ""}`}
            disabled={!hasPlayback}
            onClick={() => void window.coax.requestOverlayAction("fullscreen")}
            ref={preview}
            type="button"
          >
            {!hasPlayback && (
              <span className="preview-empty">
                <span className="empty-state-icon">
                  <Icon name="channels" />
                </span>
                <strong>
                  {state.channelId
                    ? "Starting your channel…"
                    : "Your live preview"}
                </strong>
                <small>
                  {state.channelId
                    ? "Playback will appear here when it is ready."
                    : "Choose a channel to start watching."}
                </small>
              </span>
            )}
            {hasPlayback && (
              <span className="preview-watch">
                <Icon name="expand" />
                Watch fullscreen
              </span>
            )}
          </button>

          <section className="browse-now-playing">
            <div className="browse-now-heading">
              <div>
                <p className="section-label">Now playing</p>
                <h1>{state.channelId ? state.now : "Nothing selected"}</h1>
              </div>
              <p
                className={`overlay-feedback phase-${state.phase}`}
                role="status"
              >
                <span aria-hidden="true" />
                {state.feedback}
              </p>
            </div>
            <VolumeControl state={state} />
            <div className="browse-playback-actions">
              <button
                className="watch-fullscreen-button"
                disabled={!hasPlayback}
                onClick={() =>
                  void window.coax.requestOverlayAction("fullscreen")
                }
                type="button"
              >
                <Icon name="expand" />
                Watch fullscreen
              </button>
              <button
                aria-label="Stop playback"
                className="stop-playback-button"
                disabled={!state.channelId}
                onClick={() => void window.coax.stopPlayback()}
                title="Stop playback"
                type="button"
              >
                <Icon name="stop" />
              </button>
            </div>
          </section>
        </aside>
      </main>

      <main
        className="overlay-surface"
        data-fading={state.fading || undefined}
        hidden={!showingControls}
      >
        <section
          aria-label="Playback overlay"
          className="overlay-panel"
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
              </div>
              <div className="fullscreen-actions">
                <VolumeControl compact state={state} />
                <div
                  className="overlay-controls"
                  aria-label="Playback controls"
                >
                  <button
                    aria-label="Exit fullscreen"
                    ref={(element) => {
                      controls.current[0] = element;
                    }}
                    type="button"
                    onClick={() =>
                      void window.coax.requestOverlayAction("browse")
                    }
                  >
                    <Icon name="collapse" />
                    <span>Exit fullscreen</span>
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
                    aria-label="Stop playback"
                    className="stop-control"
                    ref={(element) => {
                      controls.current[2] = element;
                    }}
                    type="button"
                    onClick={() => void window.coax.stopPlayback()}
                  >
                    <Icon name="stop" />
                    <span>Stop</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
