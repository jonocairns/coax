import { createHash } from "node:crypto";
import type {
  ChannelTransport,
  ProviderCategoryView,
  ProviderChannelView,
  ProviderFailureKind,
} from "../../shared/provider";
import type {
  ScopedHttpSettings,
  XtreamCredentials,
  XtreamOutputFormat,
} from "./config";
import type {
  ResolvedProviderPlayback,
  TrustedProviderCatalog,
  TrustedProviderChannel,
} from "./protocol";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

export class ProviderRequestError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    readonly code: string,
  ) {
    super(code);
    this.name = "ProviderRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(prefix: "xtc" | "xch", parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\0"), "utf8")
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const identifier = String(value);
  if (!/^[0-9]{1,20}$/.test(identifier) || identifier === "0") return null;
  return identifier;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .trim();
  return name.length > 0 && name.length <= 200 ? name : null;
}

function buildHeaders(settings: ScopedHttpSettings): Headers {
  const headers = new Headers(settings.headers);
  headers.set("Accept", "application/json");
  if (settings.cookie) headers.set("Cookie", settings.cookie);
  if (settings.referer) headers.set("Referer", settings.referer);
  if (settings.userAgent) headers.set("User-Agent", settings.userAgent);
  return headers;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new ProviderRequestError("provider-data", "provider-body-too-large");
  }
  if (!response.body) {
    throw new ProviderRequestError("provider-data", "provider-body-missing");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProviderRequestError(
        "provider-data",
        "provider-body-too-large",
      );
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks, total).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    throw new ProviderRequestError("provider-data", "provider-json-invalid");
  }
}

function requestUrl(
  credentials: XtreamCredentials,
  action?: "get_live_categories" | "get_live_streams",
): URL {
  const url = new URL("player_api.php", credentials.baseUrl);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  if (action) url.searchParams.set("action", action);
  return url;
}

async function fetchProviderJson(
  initialUrl: URL,
  settings: ScopedHttpSettings,
  fetchImplementation: typeof fetch,
): Promise<unknown> {
  const expectedOrigin = initialUrl.origin;
  let url = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        headers: buildHeaders(settings),
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      throw new ProviderRequestError("transport", "provider-request-failed");
    }
    if (response.status === 401 || response.status === 403) {
      clearTimeout(timeout);
      throw new ProviderRequestError(
        "authentication",
        "provider-authentication-rejected",
      );
    }
    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timeout);
      if (redirect === MAX_REDIRECTS) {
        throw new ProviderRequestError("transport", "provider-redirect-limit");
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new ProviderRequestError(
          "transport",
          "provider-redirect-invalid",
        );
      }
      let redirected: URL;
      try {
        redirected = new URL(location, url);
      } catch {
        throw new ProviderRequestError(
          "transport",
          "provider-redirect-invalid",
        );
      }
      if (
        redirected.origin !== expectedOrigin ||
        !["http:", "https:"].includes(redirected.protocol)
      ) {
        throw new ProviderRequestError(
          "configuration",
          "provider-cross-origin-redirect",
        );
      }
      url = redirected;
      continue;
    }
    if (!response.ok) {
      clearTimeout(timeout);
      throw new ProviderRequestError("transport", "provider-http-failure");
    }
    try {
      return await readBoundedJson(response);
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      throw new ProviderRequestError("transport", "provider-request-failed");
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ProviderRequestError("transport", "provider-redirect-limit");
}

function validateAccount(
  payload: unknown,
  configuredFormats: readonly XtreamOutputFormat[],
): readonly XtreamOutputFormat[] {
  if (!isRecord(payload) || !isRecord(payload.user_info)) {
    throw new ProviderRequestError(
      "provider-data",
      "provider-account-shape-invalid",
    );
  }
  const authenticated = payload.user_info.auth;
  if (authenticated !== 1 && authenticated !== "1") {
    throw new ProviderRequestError(
      "authentication",
      "provider-authentication-rejected",
    );
  }
  const status = payload.user_info.status;
  if (status !== undefined && typeof status !== "string") {
    throw new ProviderRequestError(
      "provider-data",
      "provider-account-status-invalid",
    );
  }
  if (typeof status === "string" && status.toLowerCase() !== "active") {
    throw new ProviderRequestError(
      "authentication",
      "provider-authentication-rejected",
    );
  }
  const advertised = payload.user_info.allowed_output_formats;
  if (advertised === undefined) return configuredFormats;
  if (!Array.isArray(advertised)) {
    throw new ProviderRequestError(
      "provider-data",
      "provider-output-formats-invalid",
    );
  }
  const supported = new Set(
    advertised.filter(
      (format): format is XtreamOutputFormat =>
        format === "ts" || format === "m3u8",
    ),
  );
  const selected = configuredFormats.filter((format) => supported.has(format));
  if (selected.length === 0) {
    throw new ProviderRequestError(
      "configuration",
      "provider-output-format-unavailable",
    );
  }
  return selected;
}

export function normalizeXtreamCatalog(
  origin: string,
  categoryPayload: unknown,
  streamPayload: unknown,
  formats: readonly XtreamOutputFormat[],
): TrustedProviderCatalog {
  if (!Array.isArray(categoryPayload) || !Array.isArray(streamPayload)) {
    throw new ProviderRequestError(
      "provider-data",
      "provider-live-shape-invalid",
    );
  }
  const categories: ProviderCategoryView[] = [];
  const categoryIds = new Map<string, string>();
  let categoriesSkipped = 0;
  for (const record of categoryPayload) {
    const rawId = isRecord(record)
      ? normalizeIdentifier(record.category_id)
      : null;
    const name = isRecord(record) ? normalizeName(record.category_name) : null;
    if (!rawId || !name || categoryIds.has(rawId)) {
      categoriesSkipped += 1;
      continue;
    }
    const id = stableId("xtc", [origin, rawId]);
    categoryIds.set(rawId, id);
    categories.push({ id, name });
  }

  const channels: TrustedProviderChannel[] = [];
  const viewChannels: ProviderChannelView[] = [];
  const seenStreams = new Set<string>();
  let channelsNormalized = 0;
  let channelsSkipped = 0;
  for (const record of streamPayload) {
    const streamId = isRecord(record)
      ? normalizeIdentifier(record.stream_id)
      : null;
    const rawCategoryId = isRecord(record)
      ? normalizeIdentifier(record.category_id)
      : null;
    const name = isRecord(record) ? normalizeName(record.name) : null;
    const categoryId = rawCategoryId
      ? categoryIds.get(rawCategoryId)
      : undefined;
    if (!streamId || !name || !categoryId || seenStreams.has(streamId)) {
      channelsSkipped += 1;
      continue;
    }
    seenStreams.add(streamId);
    channelsNormalized += 1;
    for (const format of formats) {
      const transport: ChannelTransport = format === "m3u8" ? "hls" : "mpeg-ts";
      const id = stableId("xch", [origin, streamId, format]);
      channels.push({ categoryId, format, id, name, streamId });
      viewChannels.push({ categoryId, id, name, transport });
    }
  }
  return {
    categories,
    channels,
    counts: {
      categoriesNormalized: categories.length,
      categoriesSkipped,
      channelsNormalized,
      channelsSkipped,
      playbackVariants: channels.length,
    },
    viewChannels,
  };
}

export async function refreshXtreamCatalog(
  credentials: XtreamCredentials,
  fetchImplementation: typeof fetch = fetch,
): Promise<TrustedProviderCatalog> {
  const account = await fetchProviderJson(
    requestUrl(credentials),
    credentials.providerRequest,
    fetchImplementation,
  );
  const formats = validateAccount(account, credentials.outputFormats);
  const [categories, streams] = await Promise.all([
    fetchProviderJson(
      requestUrl(credentials, "get_live_categories"),
      credentials.providerRequest,
      fetchImplementation,
    ),
    fetchProviderJson(
      requestUrl(credentials, "get_live_streams"),
      credentials.providerRequest,
      fetchImplementation,
    ),
  ]);
  return normalizeXtreamCatalog(
    new URL(credentials.baseUrl).origin,
    categories,
    streams,
    formats,
  );
}

export function resolveXtreamPlayback(
  credentials: XtreamCredentials,
  channel: TrustedProviderChannel,
): ResolvedProviderPlayback {
  const path = `live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${channel.streamId}.${channel.format}`;
  const streamUrl = new URL(path, credentials.baseUrl);
  if (!["http:", "https:"].includes(streamUrl.protocol)) {
    throw new ProviderRequestError(
      "configuration",
      "provider-stream-protocol-invalid",
    );
  }
  return {
    channelId: channel.id,
    http: credentials.playbackRequest,
    streamUrl: streamUrl.toString(),
    transport: channel.format === "m3u8" ? "hls" : "mpeg-ts",
  };
}
