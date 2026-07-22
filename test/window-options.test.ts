import { describe, expect, it } from "vitest";
import {
  createMainWindowOptions,
  createOverlayWindowOptions,
  CUSTOM_TITLE_BAR_HEIGHT,
  NATIVE_WINDOW_BACKGROUND,
  resolveContentLayerBounds,
  SECURE_WEB_PREFERENCES,
} from "../src/main/window-options";

describe("BrowserWindow security preferences", () => {
  it("keeps the renderer sandboxed and isolated from Node", () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });

    const options = createMainWindowOptions("C:\\coax\\preload.js");

    expect(options).toMatchObject({
      accentColor: false,
      autoHideMenuBar: true,
      backgroundColor: NATIVE_WINDOW_BACKGROUND,
      frame: false,
      hasShadow: false,
      roundedCorners: false,
    });
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "C:\\coax\\preload.js",
      sandbox: true,
    });
  });

  it("keeps native playback layers below the custom title bar", () => {
    const bounds = { height: 540, width: 960, x: 120, y: 80 };

    expect(resolveContentLayerBounds(bounds, false)).toEqual({
      height: 540 - CUSTOM_TITLE_BAR_HEIGHT,
      width: 960,
      x: 120,
      y: 80 + CUSTOM_TITLE_BAR_HEIGHT,
    });
    expect(resolveContentLayerBounds(bounds, true)).toEqual(bounds);
  });

  it("keeps the transparent overlay local, frameless, and equally isolated", () => {
    const options = createOverlayWindowOptions("C:\\coax\\preload.js");

    expect(options).toMatchObject({
      focusable: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      transparent: true,
    });
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "C:\\coax\\preload.js",
      sandbox: true,
    });
  });
});
