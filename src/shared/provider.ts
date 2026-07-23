export type ChannelTransport = "hls" | "mpeg-ts";

export interface ProviderCategoryView {
  id: string;
  name: string;
}

export interface ProviderChannelView {
  categoryId: string;
  id: string;
  name: string;
  transport: ChannelTransport;
}

export interface ProviderRecordCounts {
  categoriesNormalized: number;
  categoriesSkipped: number;
  channelsNormalized: number;
  channelsSkipped: number;
  playbackVariants: number;
}

export type ProviderFailureKind =
  "authentication" | "configuration" | "provider-data" | "transport";

export type XtreamOutputPreference = "hls" | "ts";

export interface XtreamSourceSetupInput {
  name: string;
  outputPreference: XtreamOutputPreference;
  password: string;
  serverUrl: string;
  username: string;
}

export type SourceMutationFailureKind =
  | "authentication"
  | "provider-data"
  | "replacement"
  | "storage"
  | "transport"
  | "validation";

export type SourceMutationResult =
  | {
      ok: true;
      phase: "not-configured" | "ready";
    }
  | {
      error: {
        code: string;
        kind: SourceMutationFailureKind;
        message: string;
      };
      ok: false;
    };

export type ProviderViewState =
  | { phase: "loading" }
  | { phase: "not-configured" }
  | {
      categories: readonly ProviderCategoryView[];
      channels: readonly ProviderChannelView[];
      counts: ProviderRecordCounts;
      phase: "ready";
      source: {
        name: string;
        type: "xtream";
      };
    }
  | {
      error: {
        code: string;
        kind: ProviderFailureKind;
        message: string;
      };
      phase: "error";
    };

export interface ChannelPlaybackIntentResult {
  accepted: boolean;
  channelId: string;
  generation: number;
}

export interface RapidProviderPlaybackResult {
  acceptedCount: number;
  finalChannelId: string;
  finalGeneration: number;
  requestCount: 30;
}

export const INTERNAL_CHANNEL_ID_PATTERN = /^xch_[a-f0-9]{24}$/;
