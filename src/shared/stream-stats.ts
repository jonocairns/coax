export interface StreamStatsSnapshot {
  adapter: string | null;
  available: boolean;
  avSyncSeconds: number | null;
  bufferSeconds: number | null;
  cachePaused: boolean;
  containerFps: number | null;
  decoder: string | null;
  decoderDroppedFrames: number | null;
  displayFps: number | null;
  estimatedVideoFps: number | null;
  generation: number;
  hardwareDecoder: string | null;
  mistimedFrames: number | null;
  outputDroppedFrames: number | null;
  outputHeight: number | null;
  outputWidth: number | null;
  sourceHeight: number | null;
  sourceWidth: number | null;
  updatedAt: number | null;
  videoOutput: string | null;
  voDelayedFrames: number | null;
  vsrConfirmed: false;
  vsrFilterAttached: boolean;
  vsrRequested: boolean;
}

export interface StreamStatsState {
  snapshot: StreamStatsSnapshot;
  visible: boolean;
}

export const INITIAL_STREAM_STATS_SNAPSHOT: Readonly<StreamStatsSnapshot> =
  Object.freeze({
    adapter: null,
    available: false,
    avSyncSeconds: null,
    bufferSeconds: null,
    cachePaused: false,
    containerFps: null,
    decoder: null,
    decoderDroppedFrames: null,
    displayFps: null,
    estimatedVideoFps: null,
    generation: 0,
    hardwareDecoder: null,
    mistimedFrames: null,
    outputDroppedFrames: null,
    outputHeight: null,
    outputWidth: null,
    sourceHeight: null,
    sourceWidth: null,
    updatedAt: null,
    videoOutput: null,
    voDelayedFrames: null,
    vsrConfirmed: false,
    vsrFilterAttached: false,
    vsrRequested: false,
  });
