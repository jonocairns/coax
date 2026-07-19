import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface LocalPlaybackInput {
  streamUrl: string;
  transport: "http" | "https";
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
