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

  constructor(
    private readonly credentials: CredentialReader,
    private readonly data: ProviderDataClient,
    private readonly playback: GenerationPlaybackTarget,
  ) {}

  async refresh(): Promise<ProviderViewState> {
    this.catalog = await this.data.refresh(await this.credentials.load());
    return this.viewState();
  }

  viewState(): ProviderViewState {
    if (!this.catalog) return { phase: "loading" };
    return {
      categories: this.catalog.categories,
      channels: this.catalog.viewChannels,
      counts: this.catalog.counts,
      phase: "ready",
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
    const resolved = await this.data.resolve(
      await this.credentials.load(),
      channel,
    );
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
