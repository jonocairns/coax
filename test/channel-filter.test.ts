import { describe, expect, it } from "vitest";
import type { ProviderChannelView } from "../src/shared/provider";
import { filterChannels } from "../src/shared/channel-filter";

const channels: readonly ProviderChannelView[] = [
  {
    categoryId: "news",
    id: "xch_000000000000000000000001",
    name: "World News",
    transport: "hls",
  },
  {
    categoryId: "sport",
    id: "xch_000000000000000000000002",
    name: "Stadium Sport",
    transport: "mpeg-ts",
  },
  {
    categoryId: "local",
    id: "xch_000000000000000000000003",
    name: "News Auckland",
    transport: "hls",
  },
];

describe("channel quick search", () => {
  it("uses the selected category while the search is empty", () => {
    expect(filterChannels(channels, "sport", "")).toEqual([channels[1]]);
  });

  it("searches every category case-insensitively", () => {
    expect(filterChannels(channels, "sport", "  NEWS ")).toEqual([
      channels[0],
      channels[2],
    ]);
  });

  it("returns a clean empty result for unmatched channels", () => {
    expect(filterChannels(channels, "news", "movies")).toEqual([]);
  });
});
