import { useEffect, useRef, useState } from "react";
import type { RuntimeVersions } from "../../shared/api";
import type { ControllerNavigationAction } from "../../shared/controller-navigation";
import { shouldApplyGeneration } from "../../shared/generation";
import type { OverlayState } from "../../shared/overlay";
import { useControllerNavigation } from "./use-controller-navigation";

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
    <main>
      <p className="eyebrow">M0a · Slice 4 · Path A</p>
      <h1>Coax</h1>
      <p>
        Native playback is embedded with a separate interactive Electron
        overlay.
      </p>
      <section aria-label="Private test stream controls">
        <p>{testChannel}</p>
        <div className="controls">
          <button type="button" onClick={() => void cycleChannel("previous")}>
            Previous
          </button>
          <button type="button" onClick={() => void cycleChannel("next")}>
            Next
          </button>
          <button type="button" onClick={() => void runRapidPlaylistTest()}>
            Run 30-change test
          </button>
          <button
            type="button"
            onClick={() => void window.coax.toggleFullscreen()}
          >
            Toggle fullscreen
          </button>
          <button
            type="button"
            onClick={() => void window.coax.requestOverlayAction("show")}
          >
            Show playback overlay
          </button>
        </div>
        <p>
          Overlay: {overlay?.visible ? "visible" : "hidden"}. Press Enter or F8
          to open; Escape or Back returns focus to the shell.
        </p>
      </section>
      {versions ? (
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
      ) : (
        <p>Reading runtime versions…</p>
      )}
    </main>
  );
}
