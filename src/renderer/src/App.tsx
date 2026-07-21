import { useEffect, useRef, useState } from "react";
import type { RuntimeVersions } from "../../shared/api";
import type { ControllerNavigationAction } from "../../shared/controller-navigation";
import { shouldApplyGeneration } from "../../shared/generation";
import type { OverlayState } from "../../shared/overlay";
import { Icon } from "./Icons";
import { useControllerNavigation } from "./use-controller-navigation";
import { ProviderBrowser } from "./ProviderBrowser";

export function App(): React.JSX.Element {
  const [versions, setVersions] = useState<RuntimeVersions | null>(null);
  const [testChannel, setTestChannel] = useState<string>("Playlist channel");
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const displayedGeneration = useRef(0);

  useEffect(() => {
    void window.coax.getRuntimeVersions().then(setVersions);
    void window.coax.getOverlayState().then(setOverlay);
    return window.coax.onOverlayState(setOverlay);
  }, []);

  function handleControllerAction(action: ControllerNavigationAction): void {
    if (action !== "back" && !overlay?.visible) {
      void window.coax.requestOverlayAction("show");
    }
  }

  useControllerNavigation(handleControllerAction);

  if (versions?.slice6Acceptance || versions?.slice7Acceptance) {
    return (
      <main className="acceptance-surface">
        <div className="brand" aria-label="Coax">
          <span className="brand-mark" aria-hidden="true" />
          <span>coax</span>
        </div>
        <section className="acceptance-card">
          <p className="section-label">Controlled playback test</p>
          <h1>
            {versions.slice7Acceptance
              ? "Sports motion benchmark"
              : "Hardware playback benchmark"}
          </h1>
          <p>
            The test is running with a fixed video profile. Playback controls
            are temporarily unavailable.
          </p>
          <span className="test-status">
            <span aria-hidden="true" /> Test in progress
          </span>
        </section>
      </main>
    );
  }

  async function cycleChannel(direction: "next" | "previous"): Promise<void> {
    try {
      const result = await window.coax.cycleTestChannel(direction);
      if (
        shouldApplyGeneration(displayedGeneration.current, result.generation)
      ) {
        displayedGeneration.current = result.generation;
        setTestChannel(
          `${result.direction === "next" ? "Next" : "Previous"} playlist channel requested · generation ${result.generation}`,
        );
      }
    } catch {
      setTestChannel("Test stream switch unavailable");
    }
  }

  async function runRapidPlaylistTest(): Promise<void> {
    try {
      const result = await window.coax.runRapidPlaylistTest();
      if (
        shouldApplyGeneration(
          displayedGeneration.current,
          result.finalGeneration,
        )
      ) {
        displayedGeneration.current = result.finalGeneration;
        setTestChannel(
          `${result.requestCount} alternating requests sent · newest generation ${result.finalGeneration} (${result.finalDirection})`,
        );
      }
    } catch {
      setTestChannel("Rapid playlist test unavailable");
    }
  }

  return (
    <main className="shell-surface">
      <header className="app-header">
        <div className="brand" aria-label="Coax home">
          <span className="brand-mark" aria-hidden="true" />
          <span>coax</span>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void window.coax.toggleFullscreen()}
        >
          <Icon name="expand" />
          <span>Fullscreen</span>
        </button>
      </header>

      <div className="shell-content">
        <section className="welcome-copy">
          <p className="section-label">Your television</p>
          <h1>What do you want to watch?</h1>
          <p>Choose a live channel and settle in.</p>
        </section>

        <ProviderBrowser />

        <details className="developer-panel">
          <summary>Playback diagnostics</summary>
          <div className="developer-panel-content">
            <div>
              <p className="diagnostic-label">Test playlist</p>
              <p>{testChannel}</p>
            </div>
            <div className="controls">
              <button
                type="button"
                onClick={() => void cycleChannel("previous")}
              >
                Previous
              </button>
              <button type="button" onClick={() => void cycleChannel("next")}>
                Next
              </button>
              <button type="button" onClick={() => void runRapidPlaylistTest()}>
                Run switching test
              </button>
              <button
                type="button"
                onClick={() => void window.coax.requestOverlayAction("show")}
              >
                Show player controls
              </button>
            </div>
            <p className="diagnostic-note">
              Player controls are {overlay?.visible ? "open" : "closed"}. Press
              Enter or F8 to open them; Escape closes them.
            </p>
            {versions && (
              <dl aria-label="Runtime versions">
                <div>
                  <dt>Electron</dt>
                  <dd>{versions.electron}</dd>
                </div>
                <div>
                  <dt>Node</dt>
                  <dd>{versions.node}</dd>
                </div>
                <div>
                  <dt>Chromium</dt>
                  <dd>{versions.chrome}</dd>
                </div>
              </dl>
            )}
          </div>
        </details>
      </div>
    </main>
  );
}
