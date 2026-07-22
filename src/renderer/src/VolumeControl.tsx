import type { OverlayState } from "../../shared/overlay";
import { Icon } from "./Icons";

export function VolumeControl({
  compact = false,
  state,
}: {
  compact?: boolean;
  state: Pick<OverlayState, "muted" | "volume">;
}): React.JSX.Element {
  return (
    <div className={compact ? "volume-control compact" : "volume-control"}>
      <button
        aria-label={state.muted ? "Unmute" : "Mute"}
        aria-pressed={state.muted}
        className="volume-mute"
        onClick={() => void window.coax.toggleMute()}
        title={state.muted ? "Unmute" : "Mute"}
        type="button"
      >
        <Icon
          name={state.muted || state.volume === 0 ? "volume-off" : "volume"}
        />
      </button>
      <label>
        <span className="visually-hidden">Volume</span>
        <input
          aria-label="Volume"
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
      <output aria-live="polite">
        {state.muted ? "Muted" : `${state.volume}%`}
      </output>
    </div>
  );
}
