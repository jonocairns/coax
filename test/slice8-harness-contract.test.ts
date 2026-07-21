import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Slice 8 clean harness contract", () => {
  it("keeps stable player paths and a null clean-run fault schedule", async () => {
    const definition = JSON.parse(
      await readFile(resolve("harness/slice8/fixtures.json"), "utf8"),
    ) as {
      contractVersion: string;
      faultSchedule: unknown;
      fixtures: Array<{ id: string; playerPath: string }>;
      schemaVersion: number;
    };

    expect(definition).toMatchObject({
      schemaVersion: 1,
      contractVersion: "coax-clean-stream-v1",
      faultSchedule: null,
    });
    expect(
      Object.fromEntries(
        definition.fixtures.map((fixture) => [fixture.id, fixture.playerPath]),
      ),
    ).toEqual({
      "clean-ts": "/v1/stream/ts",
      "clean-hls": "/v1/stream/hls/index.m3u8",
      "clean-aes128-hls": "/v1/stream/hls-aes/index.m3u8",
    });
  });
});
