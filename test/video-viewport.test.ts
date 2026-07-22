import { describe, expect, it } from "vitest";
import { resolveVideoViewportBounds } from "../src/main/video-viewport";

describe("native video viewport", () => {
  const windowBounds = { height: 540, width: 960, x: 120, y: 80 };

  it("uses the whole content area in fullscreen", () => {
    expect(resolveVideoViewportBounds(windowBounds, null)).toEqual(
      windowBounds,
    );
  });

  it("places a renderer-relative preview in screen coordinates", () => {
    expect(
      resolveVideoViewportBounds(windowBounds, {
        height: 270,
        width: 380,
        x: 580,
        y: 0,
      }),
    ).toEqual({ height: 270, width: 380, x: 700, y: 80 });
  });

  it("keeps an oversized preview inside the content area", () => {
    expect(
      resolveVideoViewportBounds(windowBounds, {
        height: 800,
        width: 800,
        x: 900,
        y: 500,
      }),
    ).toEqual({ height: 90, width: 160, x: 920, y: 530 });
  });
});
