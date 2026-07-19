export type ControllerNavigationAction =
  "accept" | "back" | "down" | "left" | "right" | "up";

const STANDARD_BUTTON_ACTIONS = Object.freeze({
  0: "accept",
  1: "back",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
}) satisfies Readonly<Record<number, ControllerNavigationAction>>;

export function newlyPressedControllerActions(
  buttons: ReadonlyArray<boolean>,
  previousButtons: ReadonlyArray<boolean>,
): ControllerNavigationAction[] {
  const actions: ControllerNavigationAction[] = [];
  for (const [indexText, action] of Object.entries(STANDARD_BUTTON_ACTIONS)) {
    const index = Number(indexText);
    if (buttons[index] && !previousButtons[index]) actions.push(action);
  }
  return actions;
}
