// Window-controls IPC contract (add-frameless-window-chrome). The renderer
// drives the frameless main window's caption controls (minimize / maximize-
// restore / close) through this surface, mirroring the `ping` four-layer
// pattern. `maximize-change` is a one-way main→renderer push.
export const WINDOW_CHANNELS = {
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  maximizeChange: "window:maximize-change",
} as const;

export type WindowChannelName =
  (typeof WINDOW_CHANNELS)[keyof typeof WINDOW_CHANNELS];

// Payload of the main→renderer `window:maximize-change` push: the window's new
// maximized state, emitted on the BrowserWindow 'maximize'/'unmaximize' events
// so the renderer swaps the maximize/restore glyph.
export interface WindowMaximizeChangePayload {
  readonly maximized: boolean;
}
