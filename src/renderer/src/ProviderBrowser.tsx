import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { filterChannels } from "../../shared/channel-filter";
import type { OverlayFeedbackPhase } from "../../shared/overlay";
import type {
  ProviderChannelView,
  ProviderViewState,
} from "../../shared/provider";
import { Icon } from "./Icons";

interface ProviderBrowserProps {
  activeChannelId?: string | null;
  compact?: boolean;
  playbackFeedback?: string;
  playbackPhase?: OverlayFeedbackPhase;
}

const ChannelButton = memo(function ChannelButton({
  active,
  categoryName,
  channel,
  pending,
  searching,
  onPlay,
}: {
  active: boolean;
  categoryName: string | undefined;
  channel: ProviderChannelView;
  onPlay: (channelId: string, name: string) => void;
  pending: boolean;
  searching: boolean;
}): React.JSX.Element {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={pending ? "is-pending" : undefined}
      onClick={() => onPlay(channel.id, channel.name)}
      type="button"
    >
      <span className="channel-mark" aria-hidden="true">
        {channel.name.slice(0, 1).toLocaleUpperCase()}
      </span>
      <span className="channel-copy">
        <span className="channel-name">{channel.name}</span>
        {searching && <small>{categoryName}</small>}
      </span>
      <small className="transport-label">
        {channel.transport === "hls" ? "HLS" : "Live"}
      </small>
      <span className="channel-play" aria-hidden="true">
        <Icon name="play" />
      </span>
    </button>
  );
});

function ProviderBrowserComponent({
  activeChannelId: controlledActiveChannelId,
  compact = false,
  playbackFeedback,
  playbackPhase,
}: ProviderBrowserProps): React.JSX.Element {
  const browserClassName = compact
    ? "provider-browser compact"
    : "provider-browser";
  const [provider, setProvider] = useState<ProviderViewState>({
    phase: "loading",
  });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [localActiveChannelId, setLocalActiveChannelId] = useState<
    string | null
  >(null);
  const [localPendingChannelId, setLocalPendingChannelId] = useState<
    string | null
  >(null);
  const [feedback, setFeedback] = useState("Select a channel to play");
  const playbackRequest = useRef(0);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const activeChannelId =
    controlledActiveChannelId === undefined
      ? localActiveChannelId
      : controlledActiveChannelId;
  const pendingChannelId =
    localPendingChannelId ??
    (playbackPhase === "zapping" || playbackPhase === "recovering"
      ? activeChannelId
      : null);

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

  const activeChannelName = useMemo(
    () =>
      provider.phase === "ready"
        ? provider.channels.find((channel) => channel.id === activeChannelId)
            ?.name
        : undefined,
    [activeChannelId, provider],
  );

  useEffect(() => {
    if (controlledActiveChannelId === null && playbackPhase === "ready") {
      playbackRequest.current += 1;
      setLocalPendingChannelId(null);
      return;
    }
    if (!activeChannelName || !playbackPhase) return;
    if (playbackPhase === "playing") {
      setLocalPendingChannelId(null);
      setFeedback(`${activeChannelName} is playing`);
    } else if (playbackPhase === "recovering") {
      setFeedback(playbackFeedback ?? `Reconnecting ${activeChannelName}`);
    } else if (playbackPhase === "zapping") {
      setFeedback(`Tuning ${activeChannelName}…`);
    }
  }, [
    activeChannelName,
    controlledActiveChannelId,
    playbackFeedback,
    playbackPhase,
  ]);

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

  const play = useCallback(async (channelId: string, name: string) => {
    const request = ++playbackRequest.current;
    setLocalPendingChannelId(channelId);
    setFeedback(`Requesting ${name}`);
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (request !== playbackRequest.current) return;
      const result = await window.coax.playProviderChannel(channelId);
      if (request !== playbackRequest.current) return;
      if (result.accepted) setLocalActiveChannelId(channelId);
      setFeedback(
        result.accepted ? `Tuning ${name}…` : "A newer channel request won",
      );
    } catch {
      if (request !== playbackRequest.current) return;
      setFeedback("Channel playback unavailable");
    } finally {
      if (request === playbackRequest.current) {
        setLocalPendingChannelId(null);
      }
    }
  }, []);

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
      {!compact && (
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
      )}

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
              <ChannelButton
                active={activeChannelId === channel.id}
                categoryName={categoryNames.get(channel.categoryId)}
                channel={channel}
                key={channel.id}
                onPlay={play}
                pending={pendingChannelId === channel.id}
                searching={isSearching}
              />
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

export const ProviderBrowser = memo(ProviderBrowserComponent);
