export interface NumericPlaybackSample {
  elapsedMs: number;
  property: string;
  value: number;
}

export interface FrameInfoSample {
  elapsedMs: number;
  interlaced: boolean | null;
  repeat: boolean | null;
  tff: boolean | null;
}

export interface SportsDiagnosticSummary {
  avsync: {
    first: number | null;
    last: number | null;
    maxAbsolute: number | null;
    slopeSecondsPerHour: number | null;
  };
  cadence: {
    expectedFps: number;
    medianFps: number | null;
    sampleCount: number;
    withinHalfFps: boolean;
  };
  counterDeltas: {
    decoderDrops: number | null;
    delayedFrames: number | null;
    mistimedFrames: number | null;
    voDrops: number | null;
  };
  frameInfo: {
    bffSamples: number;
    interlacedSamples: number;
    repeatSamples: number;
    sampleCount: number;
    tffSamples: number;
  };
}

function valuesFor(
  samples: readonly NumericPlaybackSample[],
  property: string,
): readonly NumericPlaybackSample[] {
  return [...samples]
    .filter(
      (sample) =>
        sample.property === property &&
        Number.isFinite(sample.elapsedMs) &&
        Number.isFinite(sample.value),
    )
    .sort((left, right) => left.elapsedMs - right.elapsedMs);
}

function counterDelta(
  samples: readonly NumericPlaybackSample[],
  property: string,
): number | null {
  const values = valuesFor(samples, property);
  if (values.length < 2) return null;
  const first = values[0];
  const last = values.at(-1);
  return first && last ? last.value - first.value : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];
  if (current === undefined) return null;
  if (sorted.length % 2 !== 0) return current;
  const previous = sorted[middle - 1];
  return previous === undefined ? null : (previous + current) / 2;
}

function fittedSlopePerHour(
  samples: readonly NumericPlaybackSample[],
): number | null {
  if (samples.length < 2) return null;
  const meanX =
    samples.reduce((sum, sample) => sum + sample.elapsedMs, 0) / samples.length;
  const meanY =
    samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const x = sample.elapsedMs - meanX;
    numerator += x * (sample.value - meanY);
    denominator += x * x;
  }
  if (denominator === 0) return null;
  return (numerator / denominator) * 3_600_000;
}

export function summarizeSportsDiagnostics(
  numericSamples: readonly NumericPlaybackSample[],
  frameSamples: readonly FrameInfoSample[],
  expectedFps: number,
): SportsDiagnosticSummary {
  const cadenceValues = valuesFor(numericSamples, "estimated-vf-fps").map(
    (sample) => sample.value,
  );
  const medianFps = median(cadenceValues);
  const avsync = valuesFor(numericSamples, "avsync");
  return {
    avsync: {
      first: avsync[0]?.value ?? null,
      last: avsync.at(-1)?.value ?? null,
      maxAbsolute:
        avsync.length === 0
          ? null
          : Math.max(...avsync.map((sample) => Math.abs(sample.value))),
      slopeSecondsPerHour: fittedSlopePerHour(avsync),
    },
    cadence: {
      expectedFps,
      medianFps,
      sampleCount: cadenceValues.length,
      withinHalfFps:
        medianFps !== null && Math.abs(medianFps - expectedFps) <= 0.5,
    },
    counterDeltas: {
      decoderDrops: counterDelta(numericSamples, "decoder-frame-drop-count"),
      delayedFrames: counterDelta(numericSamples, "vo-delayed-frame-count"),
      mistimedFrames: counterDelta(numericSamples, "mistimed-frame-count"),
      voDrops: counterDelta(numericSamples, "frame-drop-count"),
    },
    frameInfo: {
      bffSamples: frameSamples.filter(
        (sample) => sample.interlaced === true && sample.tff === false,
      ).length,
      interlacedSamples: frameSamples.filter(
        (sample) => sample.interlaced === true,
      ).length,
      repeatSamples: frameSamples.filter((sample) => sample.repeat === true)
        .length,
      sampleCount: frameSamples.length,
      tffSamples: frameSamples.filter(
        (sample) => sample.interlaced === true && sample.tff === true,
      ).length,
    },
  };
}
