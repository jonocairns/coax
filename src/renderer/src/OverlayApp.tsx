import { useEffect, useRef, useState } from "react";
import type { ControllerNavigationAction } from "../../shared/controller-navigation";
import { INITIAL_OVERLAY_STATE, type OverlayState } from "../../shared/overlay";
import { useControllerNavigation } from "./use-controller-navigation";

export function OverlayApp(): React.JSX.Element {
  const [state, setState] = useState<OverlayState>({
    ...INITIAL_OVERLAY_STATE,
  });
  const controls = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    void window.coax.getOverlayState().then(setState);
    return window.coax.onOverlayState(setState);
  }, []);

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
        onPointerEnter={() => void window.coax.setOverlayPointerCapture(true)}
        onPointerLeave={() => void window.coax.setOverlayPointerCapture(false)}
      >
        <div className="overlay-copy">
          <p className="overlay-kicker">Now</p>
          <h1>{state.now}</h1>
          <p className={`overlay-feedback phase-${state.phase}`} role="status">
            {state.feedback}
            {state.generation > 0 ? ` · generation ${state.generation}` : ""}
          </p>
          <p className="overlay-next">
            <span>Next</span>
            {state.next}
          </p>
        </div>
        <div className="overlay-controls">
          <button
            ref={(element) => {
              controls.current[0] = element;
            }}
            type="button"
            onClick={() => void window.coax.cycleTestChannel("previous")}
          >
            Previous
          </button>
          <button
            ref={(element) => {
              controls.current[1] = element;
            }}
            type="button"
            onClick={() => void window.coax.cycleTestChannel("next")}
          >
            Next
          </button>
          <button
            ref={(element) => {
              controls.current[2] = element;
            }}
            type="button"
            onClick={() => void window.coax.requestOverlayAction("hide")}
          >
            Back
          </button>
        </div>
      </section>
    </main>
  );
}
