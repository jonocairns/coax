import { useEffect, useRef, useState } from "react";
import { Play, Square, Tv } from "lucide-react";
import {
  type OverlayState,
  playbackControlsOwnController,
} from "../../shared/overlay";
import { StatusIndicator } from "./components/StatusIndicator";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
import { ProviderBrowser } from "./ProviderBrowser";
import { VolumeControl } from "./VolumeControl";

interface BrowseScreenProps {
  onInitialized: () => void;
  state: OverlayState;
}

export function BrowseScreen({
  onInitialized,
  state,
}: BrowseScreenProps): React.JSX.Element {
  const [hasPlayback, setHasPlayback] = useState(false);
  const [managingSource, setManagingSource] = useState(false);
  const preview = useRef<HTMLDivElement | null>(null);
  const browsing = state.view === "browse";

  useEffect(() => {
    if (!state.channelId) setHasPlayback(false);
    else if (state.phase === "playing") setHasPlayback(true);
  }, [state.channelId, state.phase]);

  useEffect(() => {
    const element = preview.current;
    if (!browsing || managingSource || !element) return;
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
  }, [browsing, managingSource]);

  useEffect(() => {
    void window.coax.setVideoPreviewVisible(!managingSource);
    return () => {
      void window.coax.setVideoPreviewVisible(true);
    };
  }, [managingSource]);

  return (
    <main
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.08fr)_minmax(15rem,.92fr)] overflow-hidden bg-background min-[721px]:grid-cols-[minmax(0,1.18fr)_minmax(17rem,.82fr)]"
      hidden={!browsing}
    >
      <section
        aria-label="Channel browser"
        className={cn(
          "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] bg-background",
          managingSource && "col-span-full",
        )}
      >
        <ProviderBrowser
          activeChannelId={state.channelId}
          compact
          controllerActive={!playbackControlsOwnController(state)}
          onInitialized={onInitialized}
          onSourceManagementChange={setManagingSource}
          playbackFeedback={state.feedback}
          playbackPhase={state.phase}
          sourceManagement
        />
      </section>

      <aside
        aria-label="Live preview"
        className={cn(
          "flex min-h-0 min-w-0 flex-col",
          hasPlayback ? "bg-transparent" : "bg-card",
        )}
        hidden={managingSource}
      >
        <div
          aria-label="Live video preview"
          className={cn(
            "relative isolate grid aspect-video w-full shrink-0 place-items-center overflow-hidden text-foreground",
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

        <section className="min-h-0 flex-1 bg-card p-[clamp(0.9rem,1.6vw,1.2rem)] max-[720px]:p-3.5">
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
              className="w-full disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100 dark:disabled:bg-secondary dark:disabled:text-muted-foreground"
              disabled={!hasPlayback}
              onClick={() => void window.coax.requestOverlayAction("watch")}
              size="lg"
              type="button"
            >
              <Play />
              Watch
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
  );
}
