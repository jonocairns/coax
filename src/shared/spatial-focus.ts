export type SpatialDirection = "down" | "left" | "right" | "up";

export interface SpatialFocusRect {
  bottom: number;
  id: string;
  left: number;
  right: number;
  top: number;
}

// Cone heuristic: excludes candidates behind current along the requested
// axis, then prefers staying in the same row/column over nearest overall.
export function nextSpatialFocusId(
  current: SpatialFocusRect,
  candidates: readonly SpatialFocusRect[],
  direction: SpatialDirection,
): string | null {
  const currentCenterX = (current.left + current.right) / 2;
  const currentCenterY = (current.top + current.bottom) / 2;

  let bestId: string | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    if (candidate.id === current.id) continue;
    const centerX = (candidate.left + candidate.right) / 2;
    const centerY = (candidate.top + candidate.bottom) / 2;
    const dx = centerX - currentCenterX;
    const dy = centerY - currentCenterY;
    const [primary, cross] =
      direction === "up"
        ? [-dy, dx]
        : direction === "down"
          ? [dy, dx]
          : direction === "left"
            ? [-dx, dy]
            : [dx, dy];

    if (primary <= 0) continue;
    const score = primary + Math.abs(cross) * 2;
    if (score < bestScore) {
      bestScore = score;
      bestId = candidate.id;
    }
  }

  return bestId;
}
