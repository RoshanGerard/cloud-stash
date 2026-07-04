import {
  WINDOW_CHANNELS,
  type WindowMaximizeChangePayload,
} from "@cloudstash/ipc-contracts";

// Pure, Electron-free handlers for the window-controls IPC ops (frameless main
// window, add-frameless-window-chrome). Like `ping.ts`, these take the target
// window as a structurally-typed argument so the unit test can drive them with
// a fake window under plain Node; the `ipcMain.handle(...)` registration and
// the real `BrowserWindow` live in `./index.ts`. A real `BrowserWindow`
// structurally satisfies `ControllableWindow`.
export interface ControllableWindow {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  isMaximized(): boolean;
  close(): void;
  on(event: "maximize" | "unmaximize", listener: () => void): void;
  readonly webContents: { send(channel: string, payload: unknown): void };
}

// `targetWindow` is `BrowserWindow | null` at the call site (the window may be
// gone by the time an IPC call lands), so every handler tolerates null.
export function handleWindowMinimize(win: ControllableWindow | null): void {
  win?.minimize();
}

export function handleWindowToggleMaximize(
  win: ControllableWindow | null,
): void {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
}

export function handleWindowClose(win: ControllableWindow | null): void {
  win?.close();
}

// Wire the window's maximize/unmaximize events to a one-way renderer push so
// the maximize control can swap to a restore glyph. Called once from
// `registerIpcHandlers` with the real window. Push is event-driven (not a
// renderer poll of `isMaximized`) so the glyph updates flicker-free even when
// the state changes via double-click or an OS snap.
export function wireMaximizeChange(win: ControllableWindow | null): void {
  if (!win) return;
  const push = (maximized: boolean): void => {
    const payload: WindowMaximizeChangePayload = { maximized };
    win.webContents.send(WINDOW_CHANNELS.maximizeChange, payload);
  };
  win.on("maximize", () => push(true));
  win.on("unmaximize", () => push(false));
}
