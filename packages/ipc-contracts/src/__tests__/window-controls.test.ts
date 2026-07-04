// Standing constant guard for the window-controls IPC channel table introduced
// by `add-frameless-window-chrome`. `WINDOW_CHANNELS` is the single shared
// source of truth for the four channel strings the renderer, preload, and
// desktop main agree on (minimize / toggle-maximize / close + the one-way
// maximize-change push). The test pins the exact string values and the
// maximize-change payload shape so all four layers can rely on them without
// re-reading the source.

import { describe, expect, it } from "vitest";

import {
  WINDOW_CHANNELS,
  type WindowMaximizeChangePayload,
} from "../window-controls.js";

describe("WINDOW_CHANNELS", () => {
  it("has exactly 4 keys", () => {
    expect(Object.keys(WINDOW_CHANNELS)).toHaveLength(4);
  });

  it("pins the four channel string values", () => {
    expect(WINDOW_CHANNELS).toEqual({
      minimize: "window:minimize",
      toggleMaximize: "window:toggle-maximize",
      close: "window:close",
      maximizeChange: "window:maximize-change",
    });
  });

  it("maps each key to its `window:`-prefixed channel literal", () => {
    expect(WINDOW_CHANNELS.minimize).toBe("window:minimize");
    expect(WINDOW_CHANNELS.toggleMaximize).toBe("window:toggle-maximize");
    expect(WINDOW_CHANNELS.close).toBe("window:close");
    expect(WINDOW_CHANNELS.maximizeChange).toBe("window:maximize-change");
  });
});

describe("WindowMaximizeChangePayload", () => {
  it("carries a boolean `maximized` flag (compile + runtime)", () => {
    const maximized: WindowMaximizeChangePayload = { maximized: true };
    const restored: WindowMaximizeChangePayload = { maximized: false };
    expect(maximized.maximized).toBe(true);
    expect(restored.maximized).toBe(false);
  });
});
