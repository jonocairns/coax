import { Volume2, VolumeX } from "lucide-react";
import type { OverlayState } from "../../shared/overlay";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";

export function VolumeControl({
  compact = false,
  state,
}: {
  compact?: boolean;
  state: Pick<OverlayState, "muted" | "volume">;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "mt-3 grid min-w-0 grid-cols-[auto_minmax(4rem,1fr)_3.2rem] items-center gap-3 max-[720px]:gap-2",
        compact && "m-0 w-[min(18rem,32vw)] max-[720px]:w-full",
      )}
    >
      <Button
        aria-label={state.muted ? "Unmute" : "Mute"}
        aria-pressed={state.muted}
        onClick={() => void window.coax.toggleMute()}
        size="icon-lg"
        title={state.muted ? "Unmute" : "Mute"}
        type="button"
        variant="secondary"
      >
        {state.muted || state.volume === 0 ? <VolumeX /> : <Volume2 />}
      </Button>
      <label className="flex min-w-0">
        <span className="sr-only">Volume</span>
        <input
          aria-label="Volume"
          className="w-full cursor-pointer accent-foreground"
          max="100"
          min="0"
          onChange={(event) =>
            void window.coax.setVolume(Number(event.currentTarget.value))
          }
          step="1"
          type="range"
          value={state.volume}
        />
      </label>
      <output
        className="text-right text-xs text-muted-foreground"
        aria-live="polite"
      >
        {state.muted ? "Muted" : `${state.volume}%`}
      </output>
    </div>
  );
}
