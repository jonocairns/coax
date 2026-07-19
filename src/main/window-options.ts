import type { BrowserWindowConstructorOptions, WebPreferences } from "electron";

export const SECURE_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}) satisfies Readonly<
  Pick<WebPreferences, "contextIsolation" | "nodeIntegration" | "sandbox">
>;

export function createMainWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 960,
    height: 540,
    minWidth: 640,
    minHeight: 360,
    show: false,
    backgroundColor: "#101214",
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: preloadPath,
    },
  };
}
