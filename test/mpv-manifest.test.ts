import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePinnedMpvManifest } from "../src/main/mpv/runtime-manifest";

const manifestPath = join(process.cwd(), "runtime", "mpv", "windows-x64.json");

describe("Windows mpv runtime manifest", () => {
  it("is pinned to an immutable x64 artifact and full source commits", async () => {
    const manifest = parsePinnedMpvManifest(
      await readFile(manifestPath, "utf8"),
    );

    expect(manifest.status).toBe("pinned");
    expect(manifest.target).toEqual({ platform: "win32", arch: "x64" });
    expect(manifest.artifact.url).not.toMatch(/latest/i);
    expect(manifest.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.source.buildProjectCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(manifest.source.mpvCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(manifest.source.ffmpegCommit).toMatch(/^[a-f0-9]{40}$/);
  });

  it("rejects mutable artifact aliases", async () => {
    const value = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    const artifact = value.artifact as Record<string, unknown>;
    artifact.url =
      "https://example.invalid/releases/latest/mpv-x86_64-20260610.7z";
    artifact.fileName = "mpv-x86_64-20260610.7z";

    expect(() => parsePinnedMpvManifest(JSON.stringify(value))).toThrow(
      "mutable-artifact-url",
    );
  });
});
