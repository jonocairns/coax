import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { XtreamSourceSetupInput } from "../../shared/provider";

const MAX_INPUT_BYTES = 64 * 1024;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
const BLOCKED_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "referer",
  "transfer-encoding",
  "user-agent",
]);

export type XtreamOutputFormat = "m3u8" | "ts";

export interface ScopedHttpSettings {
  cookie?: string;
  headers: Readonly<Record<string, string>>;
  referer?: string;
  userAgent?: string;
}

export interface XtreamCredentials {
  baseUrl: string;
  outputFormats: readonly XtreamOutputFormat[];
  password: string;
  playbackRequest: ScopedHttpSettings;
  providerRequest: ScopedHttpSettings;
  username: string;
}

export interface ParsedXtreamSourceSetupInput {
  credentials: XtreamCredentials;
  name: string;
}

export function parseSourceDisplayName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 80 ||
    /[\r\n\0]/.test(value)
  ) {
    throw new Error("invalid-source-name");
  }
  const name = value.trim();
  if (!name) throw new Error("invalid-source-name");
  return name;
}

export function parseXtreamSourceSetupInput(
  value: unknown,
): ParsedXtreamSourceSetupInput {
  if (!isRecord(value)) throw new Error("invalid-source-input");
  const allowed = new Set([
    "name",
    "outputPreference",
    "password",
    "serverUrl",
    "username",
  ]);
  if (
    Object.keys(value).length !== allowed.size ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error("invalid-source-input");
  }
  const input = value as unknown as XtreamSourceSetupInput;
  if (typeof input.serverUrl !== "string") {
    throw new Error("invalid-source-server-url");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.serverUrl);
  } catch {
    throw new Error("invalid-source-server-url");
  }
  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error("invalid-source-server-url");
  }
  parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/+$/, "")}/`;
  if (input.outputPreference !== "ts" && input.outputPreference !== "hls") {
    throw new Error("invalid-source-output-preference");
  }
  return {
    credentials: {
      baseUrl: parsedUrl.toString(),
      outputFormats: [input.outputPreference === "hls" ? "m3u8" : "ts"],
      password: cleanSecret(input.password, "password"),
      playbackRequest: { headers: {} },
      providerRequest: { headers: {} },
      username: cleanSecret(input.username, "username"),
    },
    name: parseSourceDisplayName(input.name),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanSecret(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1_024 ||
    /[\r\n\0]/.test(value)
  ) {
    throw new Error(`invalid-xtream-${name}`);
  }
  return value;
}

function cleanOptionalHttpValue(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096 ||
    /[\r\n\0]/.test(value)
  ) {
    throw new Error(`invalid-xtream-${name}`);
  }
  return value;
}

function parseHttpSettings(
  value: unknown,
  scope: "playback" | "provider",
): ScopedHttpSettings {
  if (value === undefined) return { headers: {} };
  if (!isRecord(value)) throw new Error(`invalid-xtream-${scope}-request`);
  const allowed = new Set(["cookie", "headers", "referer", "userAgent"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`invalid-xtream-${scope}-request-shape`);
  }
  const headersValue = value.headers ?? {};
  if (!isRecord(headersValue) || Object.keys(headersValue).length > 32) {
    throw new Error(`invalid-xtream-${scope}-headers`);
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(headersValue)) {
    if (
      !HEADER_NAME_PATTERN.test(name) ||
      BLOCKED_HEADERS.has(name.toLowerCase())
    ) {
      throw new Error(`invalid-xtream-${scope}-header-name`);
    }
    headers[name] = cleanSecret(headerValue, `${scope}-header-value`);
  }
  const cookie = cleanOptionalHttpValue(value.cookie, `${scope}-cookie`);
  const referer = cleanOptionalHttpValue(value.referer, `${scope}-referer`);
  const userAgent = cleanOptionalHttpValue(
    value.userAgent,
    `${scope}-user-agent`,
  );
  return {
    ...(cookie ? { cookie } : {}),
    headers,
    ...(referer ? { referer } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

export function parseXtreamDevelopmentInput(json: string): XtreamCredentials {
  if (Buffer.byteLength(json, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("xtream-input-too-large");
  }
  const value: unknown = JSON.parse(json.replace(/^\uFEFF/, ""));
  if (!isRecord(value)) throw new Error("invalid-xtream-input-shape");
  const allowed = new Set([
    "baseUrl",
    "outputFormats",
    "password",
    "playbackRequest",
    "providerRequest",
    "username",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("invalid-xtream-input-shape");
  }

  if (typeof value.baseUrl !== "string") {
    throw new Error("invalid-xtream-base-url");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.baseUrl);
  } catch {
    throw new Error("invalid-xtream-base-url");
  }
  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error("invalid-xtream-base-url");
  }
  parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/+$/, "")}/`;

  const formats = value.outputFormats ?? ["ts", "m3u8"];
  if (
    !Array.isArray(formats) ||
    formats.length < 1 ||
    formats.length > 2 ||
    formats.some((format) => format !== "ts" && format !== "m3u8")
  ) {
    throw new Error("invalid-xtream-output-formats");
  }
  const outputFormats = [...new Set(formats)] as XtreamOutputFormat[];

  return {
    baseUrl: parsedUrl.toString(),
    outputFormats,
    password: cleanSecret(value.password, "password"),
    playbackRequest: parseHttpSettings(value.playbackRequest, "playback"),
    providerRequest: parseHttpSettings(value.providerRequest, "provider"),
    username: cleanSecret(value.username, "username"),
  };
}

export async function readXtreamDevelopmentInput(
  applicationRoot: string,
): Promise<XtreamCredentials | null> {
  try {
    return parseXtreamDevelopmentInput(
      await readFile(
        join(applicationRoot, "config", "local", "xtream.json"),
        "utf8",
      ),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}
