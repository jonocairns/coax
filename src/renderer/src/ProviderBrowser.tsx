import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { filterChannels } from "../../shared/channel-filter";
import type { ProviderViewState } from "../../shared/provider";
import { Icon } from "./Icons";

export function ProviderBrowser({
  compact = false,
}: {
  compact?: boolean;
}): React.JSX.Element {
  const browserClassName = compact
    ? "provider-browser compact"
    : "provider-browser";
  const [provider, setProvider] = useState<ProviderViewState>({
    phase: "loading",
  });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("Select a channel to play");
  const deferredSearchQuery = useDeferredValue(searchQuery);

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

  const categoryDetails = useMemo(() => {
    if (provider.phase !== "ready") return [];
    const channelCounts = new Map<string, number>();
    for (const channel of provider.channels) {
      channelCounts.set(
        channel.categoryId,
        (channelCounts.get(channel.categoryId) ?? 0) + 1,
      );
    }
    return provider.categories.map((category) => ({
      ...category,
      channelCount: channelCounts.get(category.id) ?? 0,
    }));
  }, [provider]);

  const categoryNames = useMemo(
    () =>
      new Map(categoryDetails.map((category) => [category.id, category.name])),
    [categoryDetails],
  );

  const normalizedSearchQuery = deferredSearchQuery.trim().toLocaleLowerCase();
  const isSearching = normalizedSearchQuery.length > 0;
  const channels = useMemo(
    () =>
      provider.phase === "ready"
        ? filterChannels(
            provider.channels,
            selectedCategory,
            normalizedSearchQuery,
          )
        : [],
    [normalizedSearchQuery, provider, selectedCategory],
  );

  async function play(channelId: string, name: string): Promise<void> {
    setPendingChannelId(channelId);
    setFeedback(`Requesting ${name}`);
    try {
      const result = await window.coax.playProviderChannel(channelId);
      if (result.accepted) setActiveChannelId(channelId);
      setFeedback(
        result.accepted ? `${name} is playing` : "A newer channel request won",
      );
    } catch {
      setFeedback("Channel playback unavailable");
    } finally {
      setPendingChannelId(null);
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
    return (
      <div className={`${browserClassName} empty-state`} role="status">
        <span className="loading-ring" />
        <p>Loading your channels…</p>
      </div>
    );
  }
  if (provider.phase === "not-configured") {
    return (
      <div className={`${browserClassName} empty-state`} role="status">
        <span className="empty-state-icon">
          <Icon name="channels" />
        </span>
        <h2>No source connected</h2>
        <p>Connect a TV provider to see your live channels here.</p>
      </div>
    );
  }
  if (provider.phase === "error") {
    return (
      <div
        className={`${browserClassName} empty-state error-state`}
        role="alert"
      >
        <h2>Channels unavailable</h2>
        <p>{provider.error.message}</p>
      </div>
    );
  }

  return (
    <section className={browserClassName}>
      <div className="provider-heading">
        <div>
          <p className="section-label">Browse</p>
          <h2>Live TV</h2>
        </div>
        <span className="channel-count">
          {provider.counts.channelsNormalized}{" "}
          {provider.counts.channelsNormalized === 1 ? "channel" : "channels"}
        </span>
      </div>

      <label className="channel-search">
        <Icon name="search" />
        <span className="visually-hidden">Search channels</span>
        <input
          autoComplete="off"
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={`Search ${provider.counts.channelsNormalized} channels`}
          spellCheck={false}
          type="search"
          value={searchQuery}
        />
        {isSearching && (
          <span className="search-count" aria-live="polite">
            {channels.length} {channels.length === 1 ? "result" : "results"}
          </span>
        )}
      </label>

      <div className="channel-browser-layout">
        {!compact && (
          <nav className="category-list" aria-label="Live categories">
            {categoryDetails.map((category) => (
              <button
                aria-current={
                  !isSearching && category.id === selectedCategory
                    ? "page"
                    : undefined
                }
                key={category.id}
                onClick={() => {
                  setSelectedCategory(category.id);
                  setSearchQuery("");
                }}
                type="button"
              >
                <span>{category.name}</span>
                <small>{category.channelCount}</small>
              </button>
            ))}
          </nav>
        )}

        <div className="channel-results">
          {compact && !isSearching && (
            <label className="compact-category-select">
              <span>Category</span>
              <select
                onChange={(event) => setSelectedCategory(event.target.value)}
                value={selectedCategory ?? ""}
              >
                {categoryDetails.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name} ({category.channelCount})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="channel-results-heading">
            <p>
              {isSearching
                ? `Results for “${deferredSearchQuery.trim()}”`
                : (categoryNames.get(selectedCategory ?? "") ??
                  "Live channels")}
            </p>
          </div>
          <div className="channel-list" aria-label="Live channels">
            {channels.map((channel) => (
              <button
                aria-current={
                  activeChannelId === channel.id ? "true" : undefined
                }
                className={
                  pendingChannelId === channel.id ? "is-pending" : undefined
                }
                key={channel.id}
                onClick={() => void play(channel.id, channel.name)}
                type="button"
              >
                <span className="channel-mark" aria-hidden="true">
                  {channel.name.slice(0, 1).toLocaleUpperCase()}
                </span>
                <span className="channel-copy">
                  <span className="channel-name">{channel.name}</span>
                  {isSearching && (
                    <small>{categoryNames.get(channel.categoryId)}</small>
                  )}
                </span>
                <small className="transport-label">
                  {channel.transport === "hls" ? "HLS" : "Live"}
                </small>
                <span className="channel-play" aria-hidden="true">
                  <Icon name="play" />
                </span>
              </button>
            ))}
            {channels.length === 0 && (
              <div className="no-channel-results" role="status">
                <Icon name="search" />
                <p>No channels match “{deferredSearchQuery.trim()}”.</p>
                <button type="button" onClick={() => setSearchQuery("")}>
                  Clear search
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="provider-feedback" role="status">
        <span aria-hidden="true" />
        {feedback}
      </p>
      {!compact && provider.counts.channelsSkipped > 0 && (
        <p className="provider-note">
          {provider.counts.channelsSkipped} unavailable{" "}
          {provider.counts.channelsSkipped === 1
            ? "channel was"
            : "channels were"}{" "}
          hidden.
        </p>
      )}
      {!compact && (
        <details className="developer-details">
          <summary>Developer tools</summary>
          <button type="button" onClick={() => void runRapidProviderTest()}>
            Run channel switching test
          </button>
        </details>
      )}
    </section>
  );
}
