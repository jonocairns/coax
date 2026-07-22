import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  sanitizeLogDetails,
  StructuredPlaybackLogger,
} from "../src/main/mpv/structured-log";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Slice 8 bounded diagnostics", () => {
  it("rotates before the byte bound and retains only the configured files", async () => {
    const root = await mkdtemp(join(tmpdir(), "coax-slice8-log-"));
    temporaryRoots.push(root);
    const previousRunId = process.env.COAX_M0_RUN_ID;
    process.env.COAX_M0_RUN_ID = "slice8-rotation-test";
    const logger = new StructuredPlaybackLogger(root, 700, 3);
    if (previousRunId === undefined) delete process.env.COAX_M0_RUN_ID;
    else process.env.COAX_M0_RUN_ID = previousRunId;

    for (let index = 0; index < 12; index += 1) {
      logger.write("network-failure", 1, {
        reason: `request failed at https://user:password@example.invalid/live.ts?token=secret-${index} ${"x".repeat(220)}`,
      });
    }
    await logger.close();

    const directory = join(root, "artifacts", "m0", "slice8-rotation-test");
    const files = (await readdir(directory)).filter((name) =>
      name.startsWith("playback-events.jsonl"),
    );
    expect(files.sort()).toEqual([
      "playback-events.jsonl",
      "playback-events.jsonl.1",
      "playback-events.jsonl.2",
    ]);
    for (const file of files)
      expect((await stat(join(directory, file))).size).toBeLessThanOrEqual(700);
    const retained = (
      await Promise.all(
        files.map((file) => readFile(join(directory, file), "utf8")),
      )
    ).join("\n");
    expect(retained).not.toContain("example.invalid");
    expect(retained).not.toContain("password");
    expect(retained).not.toContain("secret-");
  });

  it.each([
    [
      "normal playback",
      {
        streamUrl:
          "https://viewer:normal-secret@provider.invalid/live.ts?token=normal-token",
        headers: "X-Playback-Secret: normal-header",
        cookie: "session=normal-cookie",
        reason: "playback-started",
      },
    ],
    [
      "authentication rejection",
      {
        reason:
          "401 from https://viewer:auth-secret@provider.invalid/live.m3u8 Authorization: Bearer auth-token",
        failureKind: "authentication",
      },
    ],
    [
      "network failure",
      {
        reason:
          "connection failed for https://provider.invalid/live.ts?access_token=network-secret Cookie: session=network-cookie",
        failureKind: "network",
      },
    ],
    [
      "raw mpv output",
      {
        rawMpvOutput:
          "[ffmpeg] Opening https://viewer:raw-secret@provider.invalid/live.ts?token=raw-token with headers X-Private: raw-header",
        reason: "mpv-output-sanitized",
      },
    ],
  ])("redacts %s before serialization", (_scenario, details) => {
    const serialized = JSON.stringify(sanitizeLogDetails(details));
    for (const secret of [
      "provider.invalid",
      "normal-secret",
      "normal-token",
      "normal-header",
      "normal-cookie",
      "auth-secret",
      "auth-token",
      "network-secret",
      "network-cookie",
      "raw-secret",
      "raw-token",
      "raw-header",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
