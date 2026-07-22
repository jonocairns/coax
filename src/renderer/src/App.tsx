import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeVersions, WindowState } from "../../shared/api";
import type { ControllerNavigationAction } from "../../shared/controller-navigation";
import { shouldApplyGeneration } from "../../shared/generation";
import type { OverlayState } from "../../shared/overlay";
import { Maximize2 } from "lucide-react";
import { Brand } from "./components/Brand";
import { StatusIndicator } from "./components/StatusIndicator";
import { TitleBar } from "./components/TitleBar";
import { Button } from "./components/ui/button";
import { useControllerNavigation } from "./use-controller-navigation";
import { ProviderBrowser } from "./ProviderBrowser";

export function App(): React.JSX.Element {
  const [versions, setVersions] = useState<RuntimeVersions | null>(null);
  const [providerInitialized, setProviderInitialized] = useState(false);
  const [testChannel, setTestChannel] = useState<string>("Playlist channel");
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [windowState, setWindowState] = useState<WindowState>({
    fullscreen: false,
    maximized: false,
  });
  const displayedGeneration = useRef(0);

  useEffect(() => {
    void window.coax.getRuntimeVersions().then(setVersions);
    void window.coax.getOverlayState().then(setOverlay);
    void window.coax.getWindowState().then(setWindowState);
    const removeOverlayListener = window.coax.onOverlayState(setOverlay);
    const removeWindowListener = window.coax.onWindowState(setWindowState);
    return () => {
      removeOverlayListener();
      removeWindowListener();
    };
  }, []);

  function handleControllerAction(action: ControllerNavigationAction): void {
    if (action !== "back" && !overlay?.visible) {
      void window.coax.requestOverlayAction("show");
    }
  }

  useControllerNavigation(handleControllerAction);

  const handleProviderInitialized = useCallback(() => {
    setProviderInitialized(true);
  }, []);

  if (versions?.slice6Acceptance || versions?.slice7Acceptance) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TitleBar state={windowState} />
        <main className="relative grid min-h-0 flex-1 place-items-center p-8">
          <Brand className="absolute top-6 left-8" />
          <section className="w-full max-w-3xl">
            <p className="mb-2 text-[0.68rem] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
              Controlled playback test
            </p>
            <h1 className="mb-3 text-[clamp(2.5rem,5vw,4.75rem)] leading-none font-semibold tracking-[-0.055em]">
              {versions.slice7Acceptance
                ? "Sports motion benchmark"
                : "Hardware playback benchmark"}
            </h1>
            <p className="text-lg text-muted-foreground">
              The test is running with a fixed video profile. Playback controls
              are temporarily unavailable.
            </p>
            <StatusIndicator className="mt-4 rounded-full border bg-card px-3 py-2">
              Test in progress
            </StatusIndicator>
          </section>
        </main>
      </div>
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
    <main
      aria-busy={!providerInitialized}
      className="flex h-screen flex-col overflow-hidden bg-background"
    >
      <TitleBar state={windowState} />
      {!providerInitialized && (
        <div
          aria-label="Loading channels"
          className="fixed inset-x-0 bottom-0 z-50 grid place-items-center bg-background data-[fullscreen=false]:top-11 data-[fullscreen=true]:top-0"
          data-fullscreen={windowState.fullscreen}
          role="status"
        >
          <span className="size-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      )}

      <div
        aria-hidden={!providerInitialized}
        className={
          providerInitialized ? "min-h-0 flex-1 overflow-y-auto" : "hidden"
        }
        inert={providerInitialized ? undefined : true}
      >
        <header className="flex h-19 items-center justify-between border-b px-[clamp(1.25rem,4vw,4rem)]">
          <Brand />
          <Button
            className="text-muted-foreground max-[720px]:[&_span]:sr-only"
            type="button"
            variant="ghost"
            onClick={() => void window.coax.toggleFullscreen()}
          >
            <Maximize2 />
            <span>Fullscreen</span>
          </Button>
        </header>

        <div className="mx-auto w-full max-w-7xl px-5 pt-[clamp(3rem,8vh,6.5rem)] pb-12 max-[720px]:px-3 max-[720px]:pt-10">
          <section className="mb-[clamp(2rem,5vh,3.5rem)] max-w-3xl">
            <p className="mb-2 text-[0.68rem] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
              Your television
            </p>
            <h1 className="mb-3 text-[clamp(2.5rem,5vw,4.75rem)] leading-none font-semibold tracking-[-0.055em]">
              What do you want to watch?
            </h1>
            <p className="text-lg text-muted-foreground">
              Choose a live channel and settle in.
            </p>
          </section>

          <ProviderBrowser onInitialized={handleProviderInitialized} />

          <details className="mt-4 rounded-xl border border-transparent text-xs text-muted-foreground open:border-border open:bg-card/40 open:p-4">
            <summary className="w-fit rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Playback diagnostics
            </summary>
            <div className="pt-5">
              <div>
                <p className="mb-2 text-[0.68rem] font-semibold tracking-[0.11em] uppercase">
                  Test playlist
                </p>
                <p className="mb-3">{testChannel}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void cycleChannel("previous")}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void cycleChannel("next")}
                >
                  Next
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void runRapidPlaylistTest()}
                >
                  Run switching test
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void window.coax.requestOverlayAction("show")}
                >
                  Show player controls
                </Button>
              </div>
              <p className="mt-4 mb-3">
                Player controls are {overlay?.visible ? "open" : "closed"}.
                Press Enter or F8 to open them; Escape closes them.
              </p>
              {versions && (
                <dl
                  aria-label="Runtime versions"
                  className="mt-5 flex flex-wrap gap-6"
                >
                  <div>
                    <dt className="text-[0.65rem] uppercase">Electron</dt>
                    <dd className="mt-1 font-mono text-foreground/70">
                      {versions.electron}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] uppercase">Node</dt>
                    <dd className="mt-1 font-mono text-foreground/70">
                      {versions.node}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] uppercase">Chromium</dt>
                    <dd className="mt-1 font-mono text-foreground/70">
                      {versions.chrome}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </details>
        </div>
      </div>
    </main>
  );
}
