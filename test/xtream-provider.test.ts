import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  parseXtreamDevelopmentInput,
  type XtreamCredentials,
} from "../src/main/provider/config";
import {
  ProviderRequestError,
  normalizeXtreamCatalog,
  refreshXtreamCatalog,
  resolveXtreamPlayback,
} from "../src/main/provider/xtream";

interface Fixture {
  account: unknown;
  categories: unknown;
  streams: unknown;
}

let fixture: Fixture;
let credentials: XtreamCredentials;

beforeAll(async () => {
  fixture = JSON.parse(
    await readFile(
      resolve(process.cwd(), "test", "fixtures", "xtream-api-shape.json"),
      "utf8",
    ),
  ) as Fixture;
  credentials = parseXtreamDevelopmentInput(
    JSON.stringify({
      baseUrl: "https://provider.invalid/",
      outputFormats: ["ts", "m3u8"],
      password: "fixture-password",
      playbackRequest: {
        cookie: "playback=fixture",
        headers: { "X-Playback": "fixture" },
        referer: "https://player.invalid/",
        userAgent: "Fixture player",
      },
      providerRequest: {
        headers: { "X-Provider": "fixture" },
        userAgent: "Fixture API",
      },
      username: "fixture-user",
    }),
  );
});

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("minimum Xtream live adapter", () => {
  it("validates, fetches only categories/streams, normalizes, and skips malformed records", async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(new Headers(init?.headers).get("X-Provider")).toBe("fixture");
        const action = url.searchParams.get("action");
        if (action === "get_live_categories")
          return response(fixture.categories);
        if (action === "get_live_streams") return response(fixture.streams);
        return response(fixture.account);
      },
    ) as unknown as typeof fetch;

    const catalog = await refreshXtreamCatalog(credentials, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(catalog.counts).toEqual({
      categoriesNormalized: 2,
      categoriesSkipped: 1,
      channelsNormalized: 2,
      channelsSkipped: 2,
      playbackVariants: 4,
    });
    expect(catalog.viewChannels.map((channel) => channel.transport)).toEqual([
      "mpeg-ts",
      "hls",
      "mpeg-ts",
      "hls",
    ]);
    const repeated = normalizeXtreamCatalog(
      "https://provider.invalid",
      fixture.categories,
      fixture.streams,
      ["ts", "m3u8"],
    );
    expect(repeated.viewChannels.map(({ id }) => id)).toEqual(
      catalog.viewChannels.map(({ id }) => id),
    );
  });

  it("stops immediately on invalid credentials without category/stream transport retries", async () => {
    const fetcher = vi.fn(async () =>
      response({ user_info: { auth: 0, status: "Disabled" } }),
    ) as unknown as typeof fetch;

    await expect(refreshXtreamCatalog(credentials, fetcher)).rejects.toEqual(
      expect.objectContaining<Partial<ProviderRequestError>>({
        code: "provider-authentication-rejected",
        kind: "authentication",
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("resolves TS and HLS URLs plus playback-only HTTP settings inside the trusted model", () => {
    const catalog = normalizeXtreamCatalog(
      "https://provider.invalid",
      fixture.categories,
      fixture.streams,
      ["ts", "m3u8"],
    );
    const tsChannel = catalog.channels[0];
    const hlsChannel = catalog.channels[1];
    if (!tsChannel || !hlsChannel) throw new Error("fixture-invalid");
    const ts = resolveXtreamPlayback(credentials, tsChannel);
    const hls = resolveXtreamPlayback(credentials, hlsChannel);

    expect(ts.transport).toBe("mpeg-ts");
    expect(new URL(ts.streamUrl).pathname).toMatch(/\.ts$/);
    expect(hls.transport).toBe("hls");
    expect(new URL(hls.streamUrl).pathname).toMatch(/\.m3u8$/);
    expect(hls.http).toEqual(credentials.playbackRequest);
    expect(JSON.stringify(catalog.viewChannels)).not.toContain("fixture-user");
    expect(JSON.stringify(catalog.viewChannels)).not.toContain("streamUrl");
  });
});
