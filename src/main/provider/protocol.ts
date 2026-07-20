import type {
  ProviderCategoryView,
  ProviderChannelView,
  ProviderFailureKind,
  ProviderRecordCounts,
} from "../../shared/provider";
import type { ScopedHttpSettings, XtreamCredentials } from "./config";

export interface TrustedProviderChannel {
  categoryId: string;
  format: "m3u8" | "ts";
  id: string;
  name: string;
  streamId: string;
}

export interface TrustedProviderCatalog {
  categories: readonly ProviderCategoryView[];
  channels: readonly TrustedProviderChannel[];
  counts: ProviderRecordCounts;
  viewChannels: readonly ProviderChannelView[];
}

export interface ResolvedProviderPlayback {
  channelId: string;
  http: ScopedHttpSettings;
  streamUrl: string;
  transport: "hls" | "mpeg-ts";
}

export type ProviderWorkerRequest =
  | {
      credentials: XtreamCredentials;
      id: number;
      type: "refresh";
    }
  | {
      channel: TrustedProviderChannel;
      credentials: XtreamCredentials;
      id: number;
      type: "resolve";
    };

export type ProviderWorkerResponse =
  | {
      catalog: TrustedProviderCatalog;
      id: number;
      ok: true;
      type: "refresh";
    }
  | {
      id: number;
      ok: true;
      playback: ResolvedProviderPlayback;
      type: "resolve";
    }
  | {
      error: { code: string; kind: ProviderFailureKind };
      id: number;
      ok: false;
    };
