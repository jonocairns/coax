import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveSportsFixtureProfile } from "./sports-profile";

export interface LocalPlaybackInput {
  streamUrl: string;
  transport: "http" | "https";
}

export interface MpvHttpOptions {
  cookie?: string;
  headers: Readonly<Record<string, string>>;
  referer?: string;
  userAgent?: string;
}

export interface MpvPlaybackInput {
  channelId?: string;
  http?: MpvHttpOptions;
  streamUrl: string;
  transport: "hls" | "http" | "https" | "mpeg-ts" | "synthetic";
}

export async function readSlice6SyntheticInput(
  applicationRoot: string,
  fixtureName: string | undefined,
): Promise<MpvPlaybackInput | null> {
  if (!fixtureName) return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,95}\.(?:mkv|mp4|mpegts)$/i.test(fixtureName)) {
    throw new Error("invalid-slice6-fixture-name");
  }
  const path = join(
    applicationRoot,
    "artifacts",
    "m0",
    "fixtures",
    fixtureName,
  );
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error("invalid-slice6-fixture-file");
  }
  return { streamUrl: path, transport: "synthetic" };
}

export async function readSlice7SyntheticInput(
  applicationRoot: string,
  fixtureName: string | undefined,
): Promise<MpvPlaybackInput | null> {
  const profile = resolveSportsFixtureProfile(fixtureName);
  if (!profile) {
    if (!fixtureName) return null;
    throw new Error("invalid-slice7-fixture-name");
  }
  const path = join(
    applicationRoot,
    "artifacts",
    "m0",
    "fixtures",
    profile.fileName,
  );
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error("invalid-slice7-fixture-file");
  }
  return { streamUrl: path, transport: "synthetic" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLocalPlaybackInput(json: string): LocalPlaybackInput {
  if (Buffer.byteLength(json, "utf8") > 16 * 1024) {
    throw new Error("playback-input-too-large");
  }

  const value: unknown = JSON.parse(json.replace(/^\uFEFF/, ""));
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    throw new Error("invalid-playback-input-shape");
  }
  if (typeof value.streamUrl !== "string" || value.streamUrl.length === 0) {
    throw new Error("invalid-playback-input-url");
  }

  let url: URL;
  try {
    url = new URL(value.streamUrl);
  } catch {
    throw new Error("invalid-playback-input-url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported-playback-input-protocol");
  }

  return {
    streamUrl: value.streamUrl,
    transport: url.protocol === "https:" ? "https" : "http",
  };
}

export async function readLocalPlaybackInput(
  applicationRoot: string,
): Promise<LocalPlaybackInput | null> {
  const path = join(applicationRoot, "config", "local", "playback.json");
  try {
    return parseLocalPlaybackInput(await readFile(path, "utf8"));
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
