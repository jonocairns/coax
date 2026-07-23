import { useCallback, useEffect, useState } from "react";
import type { RuntimeVersions, WindowState } from "../../shared/api";
import { INITIAL_OVERLAY_STATE, type OverlayState } from "../../shared/overlay";
import { BrowseScreen } from "./BrowseScreen";
import { Brand } from "./components/Brand";
import { StatusIndicator } from "./components/StatusIndicator";
import { TitleBar } from "./components/TitleBar";

export function App(): React.JSX.Element {
  const [versions, setVersions] = useState<RuntimeVersions | null>(null);
  const [providerInitialized, setProviderInitialized] = useState(false);
  const [playback, setPlayback] = useState<OverlayState>({
    ...INITIAL_OVERLAY_STATE,
  });
  const [windowState, setWindowState] = useState<WindowState>({
    fullscreen: false,
    maximized: false,
  });

  useEffect(() => {
    void window.coax.getRuntimeVersions().then(setVersions);
    void window.coax.getOverlayState().then(setPlayback);
    void window.coax.getWindowState().then(setWindowState);
    const removeOverlayListener = window.coax.onOverlayState(setPlayback);
    const removeWindowListener = window.coax.onWindowState(setWindowState);
    return () => {
      removeOverlayListener();
      removeWindowListener();
    };
  }, []);

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

  return (
    <div
      aria-busy={!providerInitialized}
      className="flex h-screen flex-col overflow-hidden bg-black"
    >
      <TitleBar state={windowState} />
      {!providerInitialized && playback.view === "browse" && (
        <div
          aria-label="Loading channels"
          className="fixed inset-x-0 bottom-0 z-50 grid place-items-center bg-background data-[fullscreen=false]:top-11 data-[fullscreen=true]:top-0"
          data-fullscreen={windowState.fullscreen}
          role="status"
        >
          <span className="size-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      )}
      <BrowseScreen
        onInitialized={handleProviderInitialized}
        state={playback}
      />
    </div>
  );
}
