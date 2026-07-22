import { describe, expect, it } from "vitest";
import {
  decideGeometrySynchronization,
  presentationState,
} from "../src/main/window-lifecycle";

describe("window lifecycle geometry decisions", () => {
  it("records settled geometry after native window transitions", () => {
    const normal = { fullscreen: false, maximized: false, minimized: false };

    expect(decideGeometrySynchronization("resize", normal)).toEqual({
      record: true,
      settleDelayMs: 80,
    });
    expect(decideGeometrySynchronization("maximize", normal)).toEqual({
      record: true,
      settleDelayMs: 250,
    });
  });

  it("defers geometry while minimized and prioritizes presentation states", () => {
    expect(
      decideGeometrySynchronization("resize", {
        fullscreen: false,
        maximized: false,
        minimized: true,
      }),
    ).toEqual({ record: false, settleDelayMs: 0 });
    expect(
      presentationState({
        fullscreen: true,
        maximized: true,
        minimized: false,
      }),
    ).toBe("fullscreen");
  });
});
