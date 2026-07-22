import type { StreamStatsSnapshot } from "../../shared/stream-stats";
import { StatusIndicator } from "./components/StatusIndicator";
import { cn } from "./lib/utils";

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
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-t py-1.5 first:border-t-0">
      <dt className="shrink-0 text-[0.66rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "m-0 min-w-0 truncate text-right font-mono text-[0.68rem] text-foreground/85",
          alert && "text-warning",
        )}
      >
        {value}
      </dd>
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
    <aside
      className="ml-auto w-full max-w-4xl rounded-xl border bg-background/95 px-4.5 pt-4 pb-3.5 shadow-2xl backdrop-blur-md max-[720px]:max-h-[75vh] max-[720px]:overflow-y-auto"
      aria-label="Stream statistics"
    >
      <header className="mb-3.5 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[0.62rem] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
            Diagnostics
          </p>
          <h2 className="text-lg font-semibold tracking-tight">
            Stream health
          </h2>
        </div>
        <StatusIndicator
          tone={
            !snapshot.available
              ? "default"
              : snapshot.cachePaused
                ? "warning"
                : "success"
          }
        >
          {snapshot.available
            ? snapshot.cachePaused
              ? "Buffering"
              : "Live"
            : "Waiting for video"}
        </StatusIndicator>
      </header>

      <div className="grid grid-cols-[1fr_1.35fr_1.25fr] gap-3 max-[720px]:grid-cols-1">
        <section className="min-w-0 rounded-xl border bg-card/50 p-3">
          <h3 className="mb-2.5 text-[0.62rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">
            Signal
          </h3>
          <dl className="grid">
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
        <section className="min-w-0 rounded-xl border bg-card/50 p-3">
          <h3 className="mb-2.5 text-[0.62rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">
            Continuity
          </h3>
          <dl className="grid">
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
        <section className="min-w-0 rounded-xl border bg-card/50 p-3">
          <h3 className="mb-2.5 text-[0.62rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">
            Video path
          </h3>
          <dl className="grid">
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
      <p className="mt-3 text-[0.62rem] text-muted-foreground/75">
        Frame counters reset when the channel changes. RTX VSR attachment does
        not confirm driver processing.
      </p>
    </aside>
  );
}
