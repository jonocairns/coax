import { describe, expect, it } from "vitest";
import {
  nextSpatialFocusId,
  type SpatialFocusRect,
} from "../src/shared/spatial-focus";

const search: SpatialFocusRect = {
  bottom: 40,
  id: "search",
  left: 0,
  right: 200,
  top: 0,
};
const categoryOne: SpatialFocusRect = {
  bottom: 100,
  id: "category-1",
  left: 0,
  right: 100,
  top: 60,
};
const categoryTwo: SpatialFocusRect = {
  bottom: 140,
  id: "category-2",
  left: 0,
  right: 100,
  top: 100,
};
const channelLeft: SpatialFocusRect = {
  bottom: 100,
  id: "channel-left",
  left: 120,
  right: 220,
  top: 60,
};
const channelRight: SpatialFocusRect = {
  bottom: 100,
  id: "channel-right",
  left: 230,
  right: 330,
  top: 60,
};

const candidates = [
  search,
  categoryOne,
  categoryTwo,
  channelLeft,
  channelRight,
];

describe("spatial focus navigation", () => {
  it("moves down within the same column instead of the nearest overall element", () => {
    expect(nextSpatialFocusId(search, candidates, "down")).toBe("category-1");
  });

  it("moves further down to the next row", () => {
    expect(nextSpatialFocusId(categoryOne, candidates, "down")).toBe(
      "category-2",
    );
  });

  it("moves right from a category into the channel grid", () => {
    expect(nextSpatialFocusId(categoryOne, candidates, "right")).toBe(
      "channel-left",
    );
  });

  it("moves right across the channel grid", () => {
    expect(nextSpatialFocusId(channelLeft, candidates, "right")).toBe(
      "channel-right",
    );
  });

  it("moves up back toward search", () => {
    expect(nextSpatialFocusId(categoryOne, candidates, "up")).toBe("search");
  });

  it("returns null when nothing exists in the requested direction", () => {
    expect(nextSpatialFocusId(search, candidates, "up")).toBeNull();
  });

  it("ignores the current rect itself", () => {
    const onlySelf = nextSpatialFocusId(search, [search], "down");
    expect(onlySelf).toBeNull();
  });
});
