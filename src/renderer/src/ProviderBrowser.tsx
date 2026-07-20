import { useEffect, useMemo, useState } from "react";
import type { ProviderViewState } from "../../shared/provider";

export function ProviderBrowser({
  compact = false,
}: {
  compact?: boolean;
}): React.JSX.Element {
  const [provider, setProvider] = useState<ProviderViewState>({
    phase: "loading",
  });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("Select a channel to play");

  useEffect(() => {
    void window.coax.getProviderState().then(setProvider);
    return window.coax.onProviderState(setProvider);
  }, []);

  useEffect(() => {
    if (
      provider.phase === "ready" &&
      !provider.categories.some((category) => category.id === selectedCategory)
    ) {
      setSelectedCategory(provider.categories[0]?.id ?? null);
    }
  }, [provider, selectedCategory]);

  const channels = useMemo(
    () =>
      provider.phase === "ready"
        ? provider.channels.filter(
            (channel) => channel.categoryId === selectedCategory,
          )
        : [],
    [provider, selectedCategory],
  );

  async function play(channelId: string, name: string): Promise<void> {
    setFeedback(`Requesting ${name}`);
    try {
      const result = await window.coax.playProviderChannel(channelId);
      setFeedback(
        result.accepted
          ? `${name} requested · generation ${result.generation}`
          : "A newer channel request won",
      );
    } catch {
      setFeedback("Channel playback unavailable");
    }
  }

  async function runRapidProviderTest(): Promise<void> {
    setFeedback("Running 30 channel-ID changes");
    try {
      const result = await window.coax.runRapidProviderTest();
      setFeedback(
        `${result.requestCount} channel-ID requests · newest generation ${result.finalGeneration} · ${result.acceptedCount} accepted`,
      );
    } catch {
      setFeedback("Rapid channel-ID test unavailable");
    }
  }

  if (provider.phase === "loading") {
    return <p role="status">Loading provider channels…</p>;
  }
  if (provider.phase === "not-configured") {
    return (
      <p role="status">
        Xtream development input is not configured. Use the ignored local
        template; credentials are never entered in this window.
      </p>
    );
  }
  if (provider.phase === "error") {
    return <p role="alert">{provider.error.message}</p>;
  }

  return (
    <section
      className={compact ? "provider-browser compact" : "provider-browser"}
    >
      <div className="provider-heading">
        <h2>Live channels</h2>
        {compact ? (
          <button type="button" onClick={() => void runRapidProviderTest()}>
            Run 30 channel-ID changes
          </button>
        ) : (
          <span>
            {provider.counts.channelsNormalized} normalized ·{" "}
            {provider.counts.channelsSkipped} skipped
          </span>
        )}
      </div>
      <div className="category-tabs" aria-label="Live categories">
        {provider.categories.map((category) => (
          <button
            aria-pressed={category.id === selectedCategory}
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            type="button"
          >
            {category.name}
          </button>
        ))}
      </div>
      <div className="channel-list" aria-label="Live channels">
        {channels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => void play(channel.id, channel.name)}
            type="button"
          >
            <span>{channel.name}</span>
            <small>{channel.transport === "hls" ? "HLS" : "MPEG-TS"}</small>
          </button>
        ))}
      </div>
      <p className="provider-feedback" role="status">
        {feedback}
      </p>
      {!compact && (
        <button type="button" onClick={() => void runRapidProviderTest()}>
          Run 30 channel-ID changes
        </button>
      )}
    </section>
  );
}
