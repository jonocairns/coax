import { useEffect, useRef } from "react";
import {
  newlyPressedControllerActions,
  type ControllerNavigationAction,
} from "../../shared/controller-navigation";

export function useControllerNavigation(
  onAction: (action: ControllerNavigationAction) => void,
): void {
  const actionHandler = useRef(onAction);
  actionHandler.current = onAction;

  useEffect(() => {
    let animationFrame = 0;
    let previousButtons: boolean[] = [];

    const poll = (): void => {
      const gamepad = navigator.getGamepads().find(Boolean);
      const buttons = gamepad?.buttons.map((button) => button.pressed) ?? [];
      for (const action of newlyPressedControllerActions(
        buttons,
        previousButtons,
      )) {
        actionHandler.current(action);
      }
      previousButtons = buttons;
      animationFrame = requestAnimationFrame(poll);
    };

    animationFrame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animationFrame);
  }, []);
}
