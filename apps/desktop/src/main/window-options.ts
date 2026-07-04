import type { BrowserWindowConstructorOptions } from "electron";

// Builds the `BrowserWindowConstructorOptions` for the app's primary window.
//
// The four `webPreferences` flags below are the non-negotiable Electron
// security defaults called out in `openspec/project.md#Shared`. They are
// asserted in a unit test (`__tests__/window-options.test.ts`) so that any
// accidental weakening breaks the build before it reaches review.
//
// This module intentionally does NOT `import { BrowserWindow } from "electron"`
// at runtime — the unit test runs in Node (not Electron), and importing the
// `electron` package from a plain Node process fails. `import type` is erased
// at transpile time, so the test harness never tries to resolve the module.
//
// The window is frameless (no native OS title bar); the renderer's app header
// serves as the unified title bar. macOS uses `hiddenInset` so the native
// traffic lights stay (inset into our header); Windows/Linux use `hidden`,
// which drops the caption but keeps native resize borders + OS snap. `platform`
// is injected (defaulting to `process.platform`) so all three branches are
// unit-testable on any host without stubbing the read-only `process.platform`.
export function buildMainWindowOptions(
  preloadPath: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  const titleBarStyle = platform === "darwin" ? "hiddenInset" : "hidden";

  return {
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}
