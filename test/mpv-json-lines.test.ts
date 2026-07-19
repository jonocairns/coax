import { describe, expect, it } from "vitest";
import { JsonLineParser } from "../src/main/mpv/json-lines";

describe("mpv JSON-line parsing", () => {
  it("handles fragmented and coalesced newline-delimited messages", () => {
    const parser = new JsonLineParser();

    expect(parser.push('{"event":"start-')).toEqual([]);
    expect(
      parser.push(
        'file"}\r\n{"event":"file-loaded"}\n{"event":"video-reconfig"',
      ),
    ).toEqual([
      { ok: true, value: { event: "start-file" } },
      { ok: true, value: { event: "file-loaded" } },
    ]);
    expect(parser.push("}\n")).toEqual([
      { ok: true, value: { event: "video-reconfig" } },
    ]);
  });

  it("reports invalid JSON without retaining or returning the raw line", () => {
    const parser = new JsonLineParser();
    expect(parser.push("not private output\n")).toEqual([
      { ok: false, reason: "invalid-json" },
    ]);
  });
});
