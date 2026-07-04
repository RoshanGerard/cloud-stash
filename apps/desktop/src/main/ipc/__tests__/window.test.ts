import { describe, expect, it, vi } from "vitest";

import { WINDOW_CHANNELS } from "@cloudstash/ipc-contracts";

import {
  handleWindowClose,
  handleWindowMinimize,
  handleWindowToggleMaximize,
  wireMaximizeChange,
  type ControllableWindow,
} from "../window.js";

// A fake window whose surface is all spies. `isMaximized` is configurable so
// toggle can be exercised both ways; `on` records the registered listeners
// keyed by event so the test can fire them and assert the resulting push.
function makeFakeWindow(isMaximized = false): {
  win: ControllableWindow;
  listeners: Partial<Record<"maximize" | "unmaximize", () => void>>;
  send: ReturnType<typeof vi.fn>;
} {
  const listeners: Partial<Record<"maximize" | "unmaximize", () => void>> = {};
  const send = vi.fn();
  const win = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    isMaximized: vi.fn(() => isMaximized),
    close: vi.fn(),
    on: vi.fn((event: "maximize" | "unmaximize", listener: () => void) => {
      listeners[event] = listener;
    }),
    webContents: { send },
  } satisfies ControllableWindow;
  return { win, listeners, send };
}

describe("window-controls handlers", () => {
  describe("handleWindowMinimize", () => {
    it("calls minimize() on the window", () => {
      const { win } = makeFakeWindow();
      handleWindowMinimize(win);
      expect(win.minimize).toHaveBeenCalledTimes(1);
    });

    it("is a no-op on a null window", () => {
      expect(() => handleWindowMinimize(null)).not.toThrow();
    });
  });

  describe("handleWindowToggleMaximize", () => {
    it("unmaximizes when the window is currently maximized", () => {
      const { win } = makeFakeWindow(true);
      handleWindowToggleMaximize(win);
      expect(win.unmaximize).toHaveBeenCalledTimes(1);
      expect(win.maximize).not.toHaveBeenCalled();
    });

    it("maximizes when the window is not maximized", () => {
      const { win } = makeFakeWindow(false);
      handleWindowToggleMaximize(win);
      expect(win.maximize).toHaveBeenCalledTimes(1);
      expect(win.unmaximize).not.toHaveBeenCalled();
    });

    it("is a no-op on a null window", () => {
      expect(() => handleWindowToggleMaximize(null)).not.toThrow();
    });
  });

  describe("handleWindowClose", () => {
    it("calls close() on the window", () => {
      const { win } = makeFakeWindow();
      handleWindowClose(win);
      expect(win.close).toHaveBeenCalledTimes(1);
    });

    it("is a no-op on a null window", () => {
      expect(() => handleWindowClose(null)).not.toThrow();
    });
  });

  describe("wireMaximizeChange", () => {
    it("registers 'maximize' and 'unmaximize' listeners", () => {
      const { win } = makeFakeWindow();
      wireMaximizeChange(win);
      expect(win.on).toHaveBeenCalledWith("maximize", expect.any(Function));
      expect(win.on).toHaveBeenCalledWith("unmaximize", expect.any(Function));
    });

    it("pushes { maximized: true } on the window 'maximize' event", () => {
      const { win, listeners, send } = makeFakeWindow();
      wireMaximizeChange(win);
      listeners.maximize?.();
      expect(send).toHaveBeenCalledWith(WINDOW_CHANNELS.maximizeChange, {
        maximized: true,
      });
    });

    it("pushes { maximized: false } on the window 'unmaximize' event", () => {
      const { win, listeners, send } = makeFakeWindow();
      wireMaximizeChange(win);
      listeners.unmaximize?.();
      expect(send).toHaveBeenCalledWith(WINDOW_CHANNELS.maximizeChange, {
        maximized: false,
      });
    });

    it("registers nothing and does not throw on a null window", () => {
      expect(() => wireMaximizeChange(null)).not.toThrow();
    });
  });
});
