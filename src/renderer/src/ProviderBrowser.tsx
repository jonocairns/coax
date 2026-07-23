import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft, Play, Search, Trash2 } from "lucide-react";
import { filterChannels } from "../../shared/channel-filter";
import type { OverlayFeedbackPhase } from "../../shared/overlay";
import type {
  ProviderChannelView,
  ProviderViewState,
} from "../../shared/provider";
import { StatusIndicator } from "./components/StatusIndicator";
import { SourceSetupForm } from "./SourceSetupForm";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { cn } from "./lib/utils";

interface ProviderBrowserProps {
  activeChannelId?: string | null;
  compact?: boolean;
  onInitialized?: () => void;
  onSourceManagementChange?: (open: boolean) => void;
  playbackFeedback?: string;
  playbackPhase?: OverlayFeedbackPhase;
  sourceManagement?: boolean;
}

function SourceManagementPanel({
  channelCount,
  confirmingRemoval,
  outputLabel,
  removalError,
  removingSource,
  showReplacement,
  sourceName,
  onCancel,
  onConfirmRemoval,
  onRemove,
  onShowReplacement,
}: {
  channelCount: number;
  confirmingRemoval: boolean;
  onCancel: () => void;
  onConfirmRemoval: (confirming: boolean) => void;
  onRemove: () => void;
  onShowReplacement: (show: boolean) => void;
  outputLabel: string;
  removalError: string | null;
  removingSource: boolean;
  showReplacement: boolean;
  sourceName: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border bg-background/55 p-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-[0.68rem] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
              Settings
            </p>
            <h2 className="text-2xl font-semibold">Source management</h2>
          </div>
          <Button onClick={onCancel} type="button" variant="ghost">
            <ArrowLeft />
            Back to channels
          </Button>
        </div>
        <p className="mb-2 text-[0.68rem] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
          Current source
        </p>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-success"
                />
                <p className="text-sm font-semibold">{sourceName}</p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {channelCount} {channelCount === 1 ? "channel" : "channels"} ·{" "}
                {outputLabel}
              </p>
            </div>
            {!confirmingRemoval && (
              <Button
                onClick={() => onConfirmRemoval(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trash2 />
                Remove
              </Button>
            )}
          </div>
        </div>
        {!confirmingRemoval ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Account details stay encrypted on this device and are never shown
            here.
          </p>
        ) : (
          <div
            className="mt-3 rounded-lg border border-destructive/35 bg-destructive/5 p-4"
            role="alert"
          >
            <p className="text-sm font-medium">Remove this TV source?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Its encrypted account record will be deleted and you’ll return to
              first-run setup.
            </p>
            {removalError && (
              <p className="mt-3 text-xs text-destructive">{removalError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                disabled={removingSource}
                onClick={() => onConfirmRemoval(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Keep source
              </Button>
              <Button
                disabled={removingSource}
                onClick={onRemove}
                size="sm"
                type="button"
                variant="destructive"
              >
                <Trash2 />
                {removingSource ? "Removing…" : "Yes, remove source"}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="mx-auto mt-7 max-w-xl border-t pt-5">
        {!showReplacement ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Replace this source</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The current source stays active until its replacement is
                validated.
              </p>
            </div>
            <Button onClick={() => onShowReplacement(true)} type="button">
              Replace source
            </Button>
          </div>
        ) : (
          <SourceSetupForm
            mode="replace"
            onCancel={() => onShowReplacement(false)}
            onSaved={onCancel}
          />
        )}
      </div>
    </div>
  );
}

const ChannelButton = memo(function ChannelButton({
  active,
  categoryName,
  channel,
  compact,
  pending,
  searching,
  onPlay,
}: {
  active: boolean;
  categoryName: string | undefined;
  channel: ProviderChannelView;
  compact: boolean;
  onPlay: (channelId: string, name: string) => void;
  pending: boolean;
  searching: boolean;
}): React.JSX.Element {
  return (
    <Button
      aria-current={active ? "true" : undefined}
      className={cn(
        "group grid h-auto min-h-16 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left font-normal whitespace-normal shadow-none [contain-intrinsic-size:auto_4rem] [contain:layout_paint_style] [content-visibility:auto] hover:bg-muted/70 focus-visible:z-10 focus-visible:bg-muted/70 aria-[current=true]:bg-accent aria-[current=true]:shadow-[inset_3px_0_0_var(--brand)]",
        compact &&
          "min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] rounded-md px-2.5 py-2 max-[720px]:grid-cols-[auto_minmax(0,1fr)]",
        pending && "text-foreground/90",
      )}
      onClick={() => onPlay(channel.id, channel.name)}
      type="button"
      variant="ghost"
    >
      <span
        className={cn(
          "grid size-11 place-items-center rounded-md border bg-secondary text-sm font-bold text-secondary-foreground",
          compact && "size-8",
        )}
        aria-hidden="true"
      >
        {channel.name.slice(0, 1).toLocaleUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{channel.name}</span>
        {searching && (
          <small className="truncate text-[0.68rem] tracking-wider text-muted-foreground uppercase">
            {categoryName}
          </small>
        )}
      </span>
      {!compact && (
        <small className="text-[0.68rem] tracking-wider text-muted-foreground uppercase">
          {channel.transport === "hls" ? "HLS" : "Live"}
        </small>
      )}
      <span
        className={cn(
          "grid size-7 place-items-center rounded-full text-muted-foreground transition-opacity",
          compact &&
            "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-[current=true]:opacity-100 max-[720px]:hidden",
        )}
        aria-hidden="true"
      >
        {pending ? (
          <span className="size-4 animate-spin rounded-full border-2 border-foreground/15 border-t-brand" />
        ) : (
          <Play className="size-4" />
        )}
      </span>
    </Button>
  );
});

function ProviderBrowserComponent({
  activeChannelId: controlledActiveChannelId,
  compact = false,
  onInitialized,
  onSourceManagementChange,
  playbackFeedback,
  playbackPhase,
  sourceManagement,
}: ProviderBrowserProps): React.JSX.Element {
  const canManageSource = sourceManagement ?? !compact;
  const browserClassName = cn(
    "min-w-0 rounded-xl border bg-card p-[clamp(1.1rem,2.5vw,1.75rem)]",
    compact &&
      "grid h-full w-full overflow-hidden rounded-none border-0 bg-surface-subtle px-4 py-3 max-[720px]:px-3",
    compact &&
      (canManageSource
        ? "grid-rows-[auto_auto_minmax(0,1fr)_auto]"
        : "grid-rows-[auto_minmax(0,1fr)_auto]"),
  );
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
  const [showSourceSetup, setShowSourceSetup] = useState(false);
  const [showReplacementForm, setShowReplacementForm] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [removingSource, setRemovingSource] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);
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
    if (provider.phase !== "loading") onInitialized?.();
  }, [onInitialized, provider.phase]);

  useEffect(() => {
    if (!canManageSource || provider.phase === "loading") return;
    onSourceManagementChange?.(provider.phase !== "ready" || showSourceSetup);
  }, [
    canManageSource,
    onSourceManagementChange,
    provider.phase,
    showSourceSetup,
  ]);

  useEffect(() => {
    if (!showSourceSetup) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || provider.phase !== "ready") return;
      event.preventDefault();
      setShowSourceSetup(false);
      setShowReplacementForm(false);
      setConfirmingRemoval(false);
      setRemovalError(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [provider.phase, showSourceSetup]);

  const categoryDetails = useMemo(() => {
    if (provider.phase !== "ready") return [];
    const channelCounts = new Map<string, number>();
    for (const channel of provider.channels) {
      channelCounts.set(
        channel.categoryId,
        (channelCounts.get(channel.categoryId) ?? 0) + 1,
      );
    }
    return provider.categories.flatMap((category) => {
      const channelCount = channelCounts.get(category.id) ?? 0;
      return channelCount > 0 ? [{ ...category, channelCount }] : [];
    });
  }, [provider]);

  useEffect(() => {
    if (
      provider.phase === "ready" &&
      !categoryDetails.some((category) => category.id === selectedCategory)
    ) {
      setSelectedCategory(categoryDetails[0]?.id ?? null);
    }
  }, [categoryDetails, provider.phase, selectedCategory]);

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

  async function removeSource(): Promise<void> {
    setRemovingSource(true);
    setRemovalError(null);
    setFeedback("Removing the source and encrypted account record…");
    try {
      const result = await window.coax.removeXtreamSource();
      if (!result.ok) {
        setFeedback(result.error.message);
        setRemovalError(result.error.message);
      }
    } catch {
      setFeedback("The source could not be removed.");
      setRemovalError("The source could not be removed.");
    } finally {
      setRemovingSource(false);
    }
  }

  if (provider.phase === "loading") {
    return (
      <div
        className={cn(
          browserClassName,
          "grid min-h-68 place-content-center place-items-center p-8 text-center",
        )}
        role="status"
      >
        <span className="size-7 animate-spin rounded-full border-2 border-foreground/10 border-t-brand" />
        <p className="mt-4 text-muted-foreground">Loading your channels…</p>
      </div>
    );
  }
  if (provider.phase === "not-configured") {
    if (canManageSource) {
      return (
        <div
          className={cn(
            browserClassName,
            "min-h-68 p-8",
            compact && "block overflow-y-auto",
          )}
        >
          <SourceSetupForm />
        </div>
      );
    }
    return (
      <div
        className={cn(
          browserClassName,
          "grid min-h-68 place-content-center place-items-center p-8 text-center",
        )}
        role="status"
      >
        <h2 className="mt-4 mb-2 text-xl font-semibold">No source connected</h2>
        <p className="max-w-md text-muted-foreground">
          Connect a TV provider to see your live channels here.
        </p>
      </div>
    );
  }
  if (provider.phase === "error") {
    if (canManageSource) {
      return (
        <div
          className={cn(
            browserClassName,
            "min-h-68 p-8",
            compact && "block overflow-y-auto",
          )}
        >
          <div className="mx-auto mb-6 max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">
              The current source is unavailable
            </p>
            <p className="mt-1 text-muted-foreground">
              {provider.error.message} You can test replacement details below.
            </p>
          </div>
          <SourceSetupForm />
        </div>
      );
    }
    return (
      <div
        className={cn(
          browserClassName,
          "grid min-h-68 place-content-center place-items-center p-8 text-center",
        )}
        role="alert"
      >
        <h2 className="mb-2 text-xl font-semibold text-destructive">
          Channels unavailable
        </h2>
        <p className="max-w-md text-muted-foreground">
          {provider.error.message}
        </p>
      </div>
    );
  }

  const closeSourceManagement = (): void => {
    setShowSourceSetup(false);
    setShowReplacementForm(false);
    setConfirmingRemoval(false);
    setRemovalError(null);
    onSourceManagementChange?.(false);
  };
  const setRemovalConfirmation = (confirming: boolean): void => {
    setConfirmingRemoval(confirming);
    if (!confirming) setRemovalError(null);
  };
  const outputTransports = new Set(
    provider.channels.map((channel) => channel.transport),
  );
  const outputLabel =
    outputTransports.size > 1
      ? "MPEG-TS and HLS"
      : outputTransports.has("hls")
        ? "HLS output"
        : "MPEG-TS output";
  if (compact && canManageSource && showSourceSetup) {
    return (
      <section className={cn(browserClassName, "block overflow-y-auto p-4")}>
        <SourceManagementPanel
          channelCount={provider.counts.channelsNormalized}
          confirmingRemoval={confirmingRemoval}
          onCancel={closeSourceManagement}
          onConfirmRemoval={setRemovalConfirmation}
          onRemove={() => void removeSource()}
          onShowReplacement={setShowReplacementForm}
          outputLabel={outputLabel}
          removalError={removalError}
          removingSource={removingSource}
          showReplacement={showReplacementForm}
          sourceName={provider.source.name}
        />
      </section>
    );
  }

  return (
    <section className={browserClassName}>
      {!compact && canManageSource && showSourceSetup && (
        <div className="mb-6">
          <SourceManagementPanel
            channelCount={provider.counts.channelsNormalized}
            confirmingRemoval={confirmingRemoval}
            onCancel={closeSourceManagement}
            onConfirmRemoval={setRemovalConfirmation}
            onRemove={() => void removeSource()}
            onShowReplacement={setShowReplacementForm}
            outputLabel={outputLabel}
            removalError={removalError}
            removingSource={removingSource}
            showReplacement={showReplacementForm}
            sourceName={provider.source.name}
          />
        </div>
      )}
      {compact && canManageSource && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[0.68rem] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
            Live TV
          </p>
          <Button
            onClick={() => {
              setShowSourceSetup(true);
              onSourceManagementChange?.(true);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Manage source
          </Button>
        </div>
      )}
      {!compact && (
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[0.68rem] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
              Browse
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">Live TV</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setConfirmingRemoval(false);
                setRemovalError(null);
                setShowReplacementForm(false);
                setShowSourceSetup((visible) => !visible);
                onSourceManagementChange?.(!showSourceSetup);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Manage source
            </Button>
            <Badge variant="outline">
              {provider.counts.channelsNormalized}{" "}
              {provider.counts.channelsNormalized === 1
                ? "channel"
                : "channels"}
            </Badge>
          </div>
        </div>
      )}

      <label
        className={cn("relative block", compact ? "mt-0 mb-3" : "my-5 mb-4")}
      >
        <span className="sr-only">Search channels</span>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoComplete="off"
          className={cn(
            "pl-10 shadow-none",
            compact ? "h-10" : "h-12",
            compact && "border-transparent bg-secondary/55",
            isSearching ? "pr-24" : "pr-3",
          )}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={`Search ${provider.counts.channelsNormalized} channels`}
          spellCheck={false}
          type="search"
          value={searchQuery}
        />
        {isSearching && (
          <span
            className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {channels.length} {channels.length === 1 ? "result" : "results"}
          </span>
        )}
      </label>

      <div
        className={cn(
          "grid min-h-88 grid-cols-1 gap-4 min-[721px]:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)]",
          compact && "min-h-0 grid-cols-1 min-[721px]:grid-cols-1",
        )}
      >
        {!compact && (
          <nav
            className="grid max-h-[min(27rem,52vh)] content-start overflow-y-auto pr-1 [scrollbar-color:var(--muted)_transparent] max-[720px]:max-h-40"
            aria-label="Live categories"
          >
            {categoryDetails.map((category) => (
              <Button
                aria-current={
                  !isSearching && category.id === selectedCategory
                    ? "page"
                    : undefined
                }
                key={category.id}
                className="h-auto min-h-10 w-full justify-between gap-3 px-3 text-left text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent-foreground"
                onClick={() => {
                  setSelectedCategory(category.id);
                  setSearchQuery("");
                }}
                type="button"
                variant="ghost"
              >
                <span className="truncate">{category.name}</span>
                <small className="text-xs opacity-70">
                  {category.channelCount}
                </small>
              </Button>
            ))}
          </nav>
        )}

        <div
          className={cn(
            "min-w-0",
            compact && "grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]",
          )}
        >
          {compact && !isSearching && (
            <div className="grid gap-1.5 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <span id="category-select-label">Category</span>
              <Select
                onValueChange={setSelectedCategory}
                value={selectedCategory ?? ""}
              >
                <SelectTrigger
                  aria-labelledby="category-select-label"
                  className="w-full border-transparent bg-secondary/70 tracking-normal text-secondary-foreground normal-case shadow-none"
                >
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {categoryDetails.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name} ({category.channelCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex min-h-8 items-center">
            <p className="truncate text-xs font-semibold text-foreground/75">
              {isSearching
                ? `Results for “${deferredSearchQuery.trim()}”`
                : (categoryNames.get(selectedCategory ?? "") ??
                  "Live channels")}
            </p>
          </div>
          <div
            className={cn(
              "grid max-h-[min(25rem,48vh)] grid-cols-1 content-start gap-1 overflow-y-auto pr-1 [scrollbar-color:var(--muted)_transparent] min-[721px]:grid-cols-2",
              compact &&
                "max-h-none min-h-0 grid-cols-1 min-[721px]:grid-cols-1",
            )}
            aria-label="Live channels"
          >
            {channels.map((channel) => (
              <ChannelButton
                active={activeChannelId === channel.id}
                categoryName={categoryNames.get(channel.categoryId)}
                channel={channel}
                compact={compact}
                key={channel.id}
                onPlay={play}
                pending={pendingChannelId === channel.id}
                searching={isSearching}
              />
            ))}
            {channels.length === 0 && (
              <div
                className="col-span-full grid min-h-52 place-content-center place-items-center text-center text-muted-foreground"
                role="status"
              >
                <Search />
                <p className="mt-3 mb-3 text-sm">
                  No channels match “{deferredSearchQuery.trim()}”.
                </p>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => setSearchQuery("")}
                >
                  Clear search
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <StatusIndicator className={compact ? "mt-3" : "mt-4"}>
        {feedback}
      </StatusIndicator>
      {!compact && provider.counts.channelsSkipped > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {provider.counts.channelsSkipped} unavailable{" "}
          {provider.counts.channelsSkipped === 1
            ? "channel was"
            : "channels were"}{" "}
          hidden.
        </p>
      )}
      {!compact && (
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="w-fit rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Developer tools
          </summary>
          <Button
            className="mt-3"
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void runRapidProviderTest()}
          >
            Run channel switching test
          </Button>
        </details>
      )}
    </section>
  );
}

export const ProviderBrowser = memo(ProviderBrowserComponent);
