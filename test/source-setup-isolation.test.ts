import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("source setup renderer and preload isolation", () => {
  it("keeps form credentials out of React state and clears the password after submission", async () => {
    const source = await readFile(
      new URL("../src/renderer/src/SourceSetupForm.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/useState<[^>]*(?:Credential|Xtream|Input)/);
    expect(source).toContain('namedItem("password")');
    expect(source).toContain('password.value = ""');
    expect(source).toContain("if (result.ok) onSaved?.()");
    expect(source).not.toContain("value={password");
  });

  it("exposes only intent-specific source operations and no credential reads or raw IPC", async () => {
    const source = await readFile(
      new URL("../src/preload/index.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("configureXtreamSource");
    expect(source).toContain("removeXtreamSource");
    expect(source).not.toMatch(/get(?:Stored|Decrypted)?Credentials/);
    expect(source).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer/);
    expect(source).not.toMatch(/from ["']node:fs/);
  });

  it("owns browsing in the main shell and keeps the overlay playback-only", async () => {
    const [browseSource, overlaySource] = await Promise.all([
      readFile(
        new URL("../src/renderer/src/BrowseScreen.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/renderer/src/OverlayApp.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(browseSource).toContain("<ProviderBrowser");
    expect(browseSource).toContain("sourceManagement");
    expect(browseSource).toContain("setVideoViewport");
    expect(browseSource).toContain("setVideoPreviewVisible");
    expect(browseSource).toContain("onSourceManagementChange");
    expect(browseSource).toContain('requestOverlayAction("watch")');
    expect(browseSource).not.toContain('requestOverlayAction("fullscreen")');
    expect(overlaySource).not.toContain("ProviderBrowser");
    expect(overlaySource).not.toContain("setVideoViewport");
    expect(overlaySource).toContain('aria-label="Playback overlay"');
    expect(overlaySource).toContain('"Exit fullscreen" : "Fullscreen"');
    expect(overlaySource).toContain("toggleFullscreen");
  });
});
