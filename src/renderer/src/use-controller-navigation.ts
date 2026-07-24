import { useEffect, useRef } from "react";
import {
  newlyPressedControllerActions,
  type ControllerNavigationAction,
} from "../../shared/controller-navigation";

export function useControllerNavigation(
  onAction: (action: ControllerNavigationAction) => void,
  enabled = true,
): void {
  const actionHandler = useRef(onAction);
  actionHandler.current = onAction;
  // Only the window that currently owns controller input dispatches actions,
  // but every window keeps polling so button edges are never missed while
  // disabled — otherwise a press held across an ownership change would misfire.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let animationFrame = 0;
    let previousButtons: boolean[] = [];

    const poll = (): void => {
      const gamepad = navigator.getGamepads().find(Boolean);
      const buttons = gamepad?.buttons.map((button) => button.pressed) ?? [];
      if (enabledRef.current) {
        for (const action of newlyPressedControllerActions(
          buttons,
          previousButtons,
        )) {
          actionHandler.current(action);
        }
      }
      previousButtons = buttons;
      animationFrame = requestAnimationFrame(poll);
    };

    animationFrame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animationFrame);
  }, []);
}
