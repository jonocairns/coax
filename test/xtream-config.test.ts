import { describe, expect, it } from "vitest";
import { parseXtreamDevelopmentInput } from "../src/main/provider/config";

describe("ignored Xtream development input", () => {
  it("accepts separately scoped provider and playback HTTP settings", () => {
    const parsed = parseXtreamDevelopmentInput(
      JSON.stringify({
        baseUrl: "https://provider.invalid/root",
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

    expect(parsed.baseUrl).toBe("https://provider.invalid/root/");
    expect(parsed.providerRequest.headers).toEqual({
      "X-Provider": "fixture",
    });
    expect(parsed.playbackRequest.cookie).toBe("playback=fixture");
  });

  it("rejects credential-bearing base URLs and header injection", () => {
    expect(() =>
      parseXtreamDevelopmentInput(
        JSON.stringify({
          baseUrl: "https://user:pass@provider.invalid/",
          password: "fixture-password",
          username: "fixture-user",
        }),
      ),
    ).toThrow("invalid-xtream-base-url");
    expect(() =>
      parseXtreamDevelopmentInput(
        JSON.stringify({
          baseUrl: "https://provider.invalid/",
          password: "fixture-password",
          providerRequest: { headers: { Host: "other.invalid" } },
          username: "fixture-user",
        }),
      ),
    ).toThrow("invalid-xtream-provider-header-name");
  });
});
