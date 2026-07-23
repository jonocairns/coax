import type {
  ChannelPlaybackIntentResult,
  ProviderViewState,
} from "../../shared/provider";
import type { MpvPlaybackInput } from "../mpv/playback-input";
import type { XtreamCredentials } from "./config";
import type {
  ResolvedProviderPlayback,
  TrustedProviderCatalog,
  TrustedProviderChannel,
} from "./protocol";

export interface CredentialReader {
  load(): Promise<XtreamCredentials>;
}

export interface ProviderDataClient {
  refresh(credentials: XtreamCredentials): Promise<TrustedProviderCatalog>;
  resolve(
    credentials: XtreamCredentials,
    channel: TrustedProviderChannel,
  ): Promise<ResolvedProviderPlayback>;
}

export interface GenerationPlaybackTarget {
  isCurrentGeneration(generation: number): boolean;
  loadReserved(generation: number, input: MpvPlaybackInput): boolean;
  reserveGeneration(): number;
}

export class XtreamProviderSession {
  private catalog: TrustedProviderCatalog | null = null;
  private activeCredentials: XtreamCredentials | null = null;
  private sourceName = "Xtream source";

  constructor(
    private readonly credentials: CredentialReader,
    private readonly data: ProviderDataClient,
    private readonly playback: GenerationPlaybackTarget,
  ) {}

  async refresh(): Promise<ProviderViewState> {
    const credentials = await this.credentials.load();
    this.catalog = await this.data.refresh(credentials);
    this.activeCredentials = credentials;
    return this.viewState();
  }

  replace(
    credentials: XtreamCredentials,
    catalog: TrustedProviderCatalog,
    sourceName = "Xtream source",
  ): ProviderViewState {
    this.activeCredentials = credentials;
    this.catalog = catalog;
    this.sourceName = sourceName;
    return this.viewState();
  }

  setSourceName(sourceName: string): void {
    this.sourceName = sourceName;
  }

  clear(): void {
    this.activeCredentials = null;
    this.catalog = null;
  }

  viewState(): ProviderViewState {
    if (!this.catalog) return { phase: "loading" };
    return {
      categories: this.catalog.categories,
      channels: this.catalog.viewChannels,
      counts: this.catalog.counts,
      phase: "ready",
      source: { name: this.sourceName, type: "xtream" },
    };
  }

  channelName(channelId: string): string | null {
    return (
      this.catalog?.viewChannels.find((channel) => channel.id === channelId)
        ?.name ?? null
    );
  }

  async requestPlayback(
    channelId: string,
    onReserved: (generation: number) => void = () => undefined,
  ): Promise<ChannelPlaybackIntentResult> {
    const channel = this.catalog?.channels.find(
      (candidate) => candidate.id === channelId,
    );
    if (!channel) throw new Error("provider-channel-unavailable");
    const generation = this.playback.reserveGeneration();
    onReserved(generation);
    const credentials =
      this.activeCredentials ?? (await this.credentials.load());
    const resolved = await this.data.resolve(credentials, channel);
    const accepted =
      this.playback.isCurrentGeneration(generation) &&
      this.playback.loadReserved(generation, {
        channelId: resolved.channelId,
        http: resolved.http,
        streamUrl: resolved.streamUrl,
        transport: resolved.transport,
      });
    return { accepted, channelId, generation };
  }
}
