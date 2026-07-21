import type { StreamStatsSnapshot } from "../../shared/stream-stats";

function dimensions(width: number | null, height: number | null): string {
  return width !== null && height !== null ? `${width} × ${height}` : "—";
}

function decimal(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${value.toFixed(2)}${suffix}`;
}

function integer(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString();
}

function Stat({
  alert = false,
  label,
  value,
}: {
  alert?: boolean;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="stream-stat" data-alert={alert || undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function StreamStatsPanel({
  snapshot,
}: {
  snapshot: StreamStatsSnapshot;
}): React.JSX.Element {
  const outputDrops = snapshot.outputDroppedFrames ?? 0;
  const decoderDrops = snapshot.decoderDroppedFrames ?? 0;
  const delayedFrames = snapshot.voDelayedFrames ?? 0;
  const mistimedFrames = snapshot.mistimedFrames ?? 0;

  return (
    <aside className="stream-stats-panel" aria-label="Stream statistics">
      <header>
        <div>
          <p className="section-label">Diagnostics</p>
          <h2>Stream health</h2>
        </div>
        <span
          className={
            snapshot.cachePaused ? "health-status warning" : "health-status"
          }
        >
          <span aria-hidden="true" />
          {snapshot.available
            ? snapshot.cachePaused
              ? "Buffering"
              : "Live"
            : "Waiting for video"}
        </span>
      </header>

      <div className="stream-stats-groups">
        <section>
          <h3>Signal</h3>
          <dl>
            <Stat
              label="Source"
              value={dimensions(snapshot.sourceWidth, snapshot.sourceHeight)}
            />
            <Stat
              label="Output"
              value={dimensions(snapshot.outputWidth, snapshot.outputHeight)}
            />
            <Stat
              label="Video rate"
              value={decimal(
                snapshot.estimatedVideoFps ?? snapshot.containerFps,
                " fps",
              )}
            />
            <Stat label="Display" value={decimal(snapshot.displayFps, " Hz")} />
          </dl>
        </section>
        <section>
          <h3>Continuity</h3>
          <dl>
            <Stat
              alert={outputDrops > 0}
              label="Output drops"
              value={integer(snapshot.outputDroppedFrames)}
            />
            <Stat
              alert={decoderDrops > 0}
              label="Decoder drops"
              value={integer(snapshot.decoderDroppedFrames)}
            />
            <Stat
              alert={delayedFrames > 0}
              label="Delayed frames"
              value={integer(snapshot.voDelayedFrames)}
            />
            <Stat
              alert={mistimedFrames > 0}
              label="Mistimed frames"
              value={integer(snapshot.mistimedFrames)}
            />
            <Stat
              alert={
                snapshot.avSyncSeconds !== null &&
                Math.abs(snapshot.avSyncSeconds) > 0.05
              }
              label="A/V sync"
              value={decimal(snapshot.avSyncSeconds, " s")}
            />
            <Stat
              label="Buffer"
              value={decimal(snapshot.bufferSeconds, " s")}
            />
          </dl>
        </section>
        <section>
          <h3>Video path</h3>
          <dl>
            <Stat
              label="Decoder"
              value={snapshot.hardwareDecoder ?? snapshot.decoder ?? "—"}
            />
            <Stat label="Renderer" value={snapshot.videoOutput ?? "—"} />
            <Stat label="Adapter" value={snapshot.adapter ?? "—"} />
            <Stat
              label="RTX VSR"
              value={
                snapshot.vsrFilterAttached
                  ? "Filter attached"
                  : snapshot.vsrRequested
                    ? "Requested"
                    : "Not requested"
              }
            />
          </dl>
        </section>
      </div>
      <p className="stream-stats-note">
        Frame counters reset when the channel changes. RTX VSR attachment does
        not confirm driver processing.
      </p>
    </aside>
  );
}
