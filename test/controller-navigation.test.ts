import { describe, expect, it } from "vitest";
import { newlyPressedControllerActions } from "../src/shared/controller-navigation";

describe("standard controller navigation", () => {
  it("maps D-pad, accept, and back only on their rising edges", () => {
    const previous = Array<boolean>(16).fill(false);
    const current = [...previous];
    current[0] = true;
    current[1] = true;
    current[12] = true;
    current[15] = true;

    expect(newlyPressedControllerActions(current, previous)).toEqual([
      "accept",
      "back",
      "up",
      "right",
    ]);
    expect(newlyPressedControllerActions(current, current)).toEqual([]);
  });
});
