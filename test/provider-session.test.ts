import { describe, expect, it } from "vitest";
import type { XtreamCredentials } from "../src/main/provider/config";
import type {
  ResolvedProviderPlayback,
  TrustedProviderCatalog,
  TrustedProviderChannel,
} from "../src/main/provider/protocol";
import {
  XtreamProviderSession,
  type GenerationPlaybackTarget,
} from "../src/main/provider/session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("provider channel playback intents", () => {
  it("contains only internal IDs and preserves newest-request-wins across asynchronous resolution", async () => {
    const channels: TrustedProviderChannel[] = [
      {
        categoryId: "xtc_111111111111111111111111",
        format: "ts",
        id: "xch_111111111111111111111111",
        name: "First fixture",
        streamId: "101",
      },
      {
        categoryId: "xtc_111111111111111111111111",
        format: "m3u8",
        id: "xch_222222222222222222222222",
        name: "Second fixture",
        streamId: "102",
      },
    ];
    const catalog: TrustedProviderCatalog = {
      categories: [{ id: "xtc_111111111111111111111111", name: "Fixtures" }],
      channels,
      counts: {
        categoriesNormalized: 1,
        categoriesSkipped: 0,
        channelsNormalized: 2,
        channelsSkipped: 0,
        playbackVariants: 2,
      },
      viewChannels: channels.map((channel) => ({
        categoryId: channel.categoryId,
        id: channel.id,
        name: channel.name,
        transport: channel.format === "ts" ? "mpeg-ts" : "hls",
      })),
    };
    const firstChannel = channels[0];
    const secondChannel = channels[1];
    if (!firstChannel || !secondChannel) throw new Error("fixture-invalid");
    const first = deferred<ResolvedProviderPlayback>();
    const second = deferred<ResolvedProviderPlayback>();
    const loaded: Array<{ channelId?: string; generation: number }> = [];
    let generation = 0;
    const playback: GenerationPlaybackTarget = {
      isCurrentGeneration: (candidate) => candidate === generation,
      loadReserved: (candidate, input) => {
        loaded.push({
          channelId: input.channelId ?? "missing-channel-id",
          generation: candidate,
        });
        return true;
      },
      reserveGeneration: () => ++generation,
    };
    const credentials: XtreamCredentials = {
      baseUrl: "https://fixture-user:fixture-password@provider.invalid/",
      outputFormats: ["ts", "m3u8"],
      password: "fixture-password",
      playbackRequest: {
        cookie: "session=fixture-cookie",
        headers: { Authorization: "fixture-token" },
      },
      providerRequest: { headers: {} },
      username: "fixture-user",
    };
    const session = new XtreamProviderSession(
      { load: async () => credentials },
      {
        refresh: async () => catalog,
        resolve: async (_credentials, channel) =>
          channel.id === firstChannel.id ? first.promise : second.promise,
      },
      playback,
    );
    await session.refresh();
    const rendererState = JSON.stringify(session.viewState());
    expect(rendererState).not.toContain("streamId");
    expect(rendererState).not.toContain("fixture-user");
    expect(rendererState).not.toContain("fixture-password");
    expect(rendererState).not.toContain("fixture-cookie");
    expect(rendererState).not.toContain("fixture-token");
    expect(rendererState).not.toContain("streamUrl");

    const firstRequest = session.requestPlayback(firstChannel.id);
    const secondRequest = session.requestPlayback(secondChannel.id);
    second.resolve({
      channelId: secondChannel.id,
      http: { headers: {} },
      streamUrl: "https://fixture.invalid/second.m3u8",
      transport: "hls",
    });
    await expect(secondRequest).resolves.toMatchObject({
      accepted: true,
      channelId: secondChannel.id,
      generation: 2,
    });
    first.resolve({
      channelId: firstChannel.id,
      http: { headers: {} },
      streamUrl: "https://fixture.invalid/first.ts",
      transport: "mpeg-ts",
    });
    await expect(firstRequest).resolves.toMatchObject({
      accepted: false,
      channelId: firstChannel.id,
      generation: 1,
    });
    expect(loaded).toEqual([{ channelId: secondChannel.id, generation: 2 }]);
  });
});
