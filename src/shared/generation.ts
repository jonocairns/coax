export type GenerationDecision = "current" | "future" | "stale";

export function decideGeneration(
  latestRequested: number,
  candidate: number,
): GenerationDecision {
  if (candidate === latestRequested) return "current";
  return candidate < latestRequested ? "stale" : "future";
}

export function shouldApplyGeneration(
  displayedGeneration: number,
  candidate: number,
): boolean {
  return Number.isSafeInteger(candidate) && candidate >= displayedGeneration;
}
