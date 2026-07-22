import type { BrowserWindowConstructorOptions, WebPreferences } from "electron";

export const SECURE_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}) satisfies Readonly<
  Pick<WebPreferences, "contextIsolation" | "nodeIntegration" | "sandbox">
>;

// Native window colors mirror Studio Neutral's raised top bar and dark canvas.
export const NATIVE_WINDOW_BACKGROUND = "#111113";
export const CUSTOM_TITLE_BAR_HEIGHT = 44;

type Rectangle = Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}>;

export function resolveContentLayerBounds(
  bounds: Rectangle,
  fullscreen: boolean,
): Rectangle {
  if (fullscreen) return { ...bounds };
  return {
    ...bounds,
    height: Math.max(0, bounds.height - CUSTOM_TITLE_BAR_HEIGHT),
    y: bounds.y + CUSTOM_TITLE_BAR_HEIGHT,
  };
}

export function createMainWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    // The renderer owns the title bar so its surface can use the app theme.
    accentColor: false,
    autoHideMenuBar: true,
    width: 960,
    height: 540,
    minWidth: 640,
    minHeight: 360,
    show: false,
    backgroundColor: NATIVE_WINDOW_BACKGROUND,
    frame: false,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: preloadPath,
    },
  };
}

export function createOverlayWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 960,
    height: 540,
    show: false,
    backgroundColor: "#00000000",
    focusable: true,
    frame: false,
    hasShadow: false,
    movable: false,
    resizable: false,
    roundedCorners: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: preloadPath,
    },
  };
}
