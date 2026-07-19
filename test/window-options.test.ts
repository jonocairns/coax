import { describe, expect, it } from "vitest";
import {
  createMainWindowOptions,
  SECURE_WEB_PREFERENCES,
} from "../src/main/window-options";

describe("BrowserWindow security preferences", () => {
  it("keeps the renderer sandboxed and isolated from Node", () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });

    expect(
      createMainWindowOptions("C:\\coax\\preload.js").webPreferences,
    ).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "C:\\coax\\preload.js",
      sandbox: true,
    });
  });
});
