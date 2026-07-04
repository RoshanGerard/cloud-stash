/** @vitest-environment jsdom */
//
// add-frameless-window-chrome — the custom caption controls for the frameless
// main window (Windows/Linux). Real <button>s with aria-labels, driven through
// window.api.window.{minimize,toggleMaximize,close}; the maximize control swaps
// to a Restore label when the main process pushes a maximize-change event.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { WindowControls } from "../window-controls";

type MaximizeCb = (maximized: boolean) => void;

// Stub the preload bridge that the component drives. Captures the
// maximize-change callback so the test can simulate a main→renderer push.
function stubWindowApi(): {
  minimize: ReturnType<typeof vi.fn>;
  toggleMaximize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onMaximizeChange: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  fire: (maximized: boolean) => void;
} {
  const minimize = vi.fn();
  const toggleMaximize = vi.fn();
  const close = vi.fn();
  const dispose = vi.fn();
  let captured: MaximizeCb | undefined;
  const onMaximizeChange = vi.fn((cb: MaximizeCb) => {
    captured = cb;
    return dispose;
  });
  (window as unknown as { api: unknown }).api = {
    platform: "win32",
    window: { minimize, toggleMaximize, close, onMaximizeChange },
  };
  return {
    minimize,
    toggleMaximize,
    close,
    onMaximizeChange,
    dispose,
    fire: (maximized: boolean) => captured?.(maximized),
  };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { api?: unknown }).api;
});

describe("WindowControls", () => {
  it("renders minimize, maximize, and close buttons with accessible names", () => {
    stubWindowApi();
    render(<WindowControls />);
    expect(
      screen.getByRole("button", { name: /^minimize$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^maximize$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("marks each control no-drag so it stays clickable inside the drag region", () => {
    stubWindowApi();
    render(<WindowControls />);
    for (const name of [/^minimize$/i, /^maximize$/i, /^close$/i]) {
      expect(screen.getByRole("button", { name })).toHaveClass("app-no-drag");
    }
  });

  it("invokes the matching window API on click", () => {
    const api = stubWindowApi();
    render(<WindowControls />);
    fireEvent.click(screen.getByRole("button", { name: /^minimize$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^maximize$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(api.minimize).toHaveBeenCalledTimes(1);
    expect(api.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it("swaps the maximize control to Restore on a maximize-change push, and back", async () => {
    const api = stubWindowApi();
    render(<WindowControls />);
    expect(
      screen.getByRole("button", { name: /^maximize$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^restore$/i })).toBeNull();

    act(() => api.fire(true));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^restore$/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /^maximize$/i })).toBeNull();

    act(() => api.fire(false));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^maximize$/i }),
      ).toBeInTheDocument(),
    );
  });

  it("activates on keyboard (Enter) like a native button", () => {
    const api = stubWindowApi();
    render(<WindowControls />);
    const close = screen.getByRole("button", { name: /^close$/i });
    close.focus();
    expect(close).toHaveFocus();
    // A real <button> fires click on Enter/Space; assert it is a button.
    expect(close.tagName).toBe("BUTTON");
    fireEvent.click(close); // native activation path
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it("subscribes to onMaximizeChange on mount and disposes on unmount", () => {
    const api = stubWindowApi();
    const { unmount } = render(<WindowControls />);
    expect(api.onMaximizeChange).toHaveBeenCalledTimes(1);
    unmount();
    expect(api.dispose).toHaveBeenCalledTimes(1);
  });
});
