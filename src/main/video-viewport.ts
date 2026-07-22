import type { VideoViewport } from "../shared/api";

type Rectangle = Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}>;

export function resolveVideoViewportBounds(
  windowBounds: Rectangle,
  viewport: VideoViewport | null,
): Rectangle {
  if (!viewport) return { ...windowBounds };
  const x = Math.max(0, Math.min(viewport.x, windowBounds.width - 160));
  const y = Math.max(0, Math.min(viewport.y, windowBounds.height - 90));
  return {
    height: Math.max(90, Math.min(viewport.height, windowBounds.height - y)),
    width: Math.max(160, Math.min(viewport.width, windowBounds.width - x)),
    x: windowBounds.x + x,
    y: windowBounds.y + y,
  };
}
