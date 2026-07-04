/** @vitest-environment jsdom */
//
// Decision 14 (review-round-1) — AppHeader renders brand chrome: logo,
// product wordmark, and the ThemeSwitcher trigger. The header is
// test-mounted in isolation; integration with RootLayout is exercised
// indirectly via the dashboard tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { AppHeader } from "../app-header";

beforeEach(() => {
  // Radix Dialog needs ResizeObserver on mount.
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class MockResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(() => {
  cleanup();
});

describe("AppHeader — brand chrome (Decision 14)", () => {
  it("renders the CloudStash theme-swapped brand mark", () => {
    render(<AppHeader />);
    // restyle-cloudstash-monochrome §4.1 — the mark is now theme-swapped .svg
    // artwork rendered as two <img> elements inside a role="img" wrapper
    // (was an inline <svg> tinted through the retired crimson brand token).
    const logo = document.querySelector("[data-testid='cloudstash-logo']");
    expect(logo).not.toBeNull();
    const marks = logo!.querySelectorAll(
      "img[src^='/brand/cloudstash-mark-']",
    );
    expect(marks.length).toBe(2);
  });

  it("renders the product wordmark 'CloudStash'", () => {
    render(<AppHeader />);
    expect(
      screen.getByText(/CloudStash/i),
    ).toBeInTheDocument();
  });

  // restyle-cloudstash-monochrome §4.3 (design.md Decision 4) — the display
  // face (Bricolage Grotesque) is layered on the wordmark and section headings
  // via the `font-display` Tailwind utility; Geist stays the UI/body font.
  it("renders the wordmark in the display face (font-display)", () => {
    render(<AppHeader />);
    const wordmark = screen.getByText(/^CloudStash$/);
    expect(wordmark).toHaveClass("font-display");
  });

  it("renders a section heading (Settings dialog title) in the display face", () => {
    render(<AppHeader />);
    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    const heading = screen.getByRole("heading", { name: /^settings$/i });
    expect(heading).toHaveClass("font-display");
  });

  it("renders the ThemeSwitcher trigger (right side)", () => {
    render(<AppHeader />);
    // ThemeSwitcher renders a Button with aria-label="Toggle theme".
    const toggle = screen.getByRole("button", { name: /toggle theme/i });
    expect(toggle).toBeInTheDocument();
  });

  it("is a <header> landmark with a bottom hairline border", () => {
    const { container } = render(<AppHeader />);
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.className).toMatch(/\bborder-b\b/);
  });

  // Motion-Safe-toggle phase: the header grows a Settings icon button that
  // opens the SettingsDialog. It sits BEFORE the ThemeSwitcher (left of
  // it) so the order reads: [logo/title] … [settings] [theme]. The button
  // uses the same ghost-icon variant and is keyboard-accessible.
  it("renders a Settings button with an accessible name", () => {
    render(<AppHeader />);
    const settings = screen.getByRole("button", { name: /open settings/i });
    expect(settings).toBeInTheDocument();
  });

  it("clicking the Settings button opens the Settings dialog", () => {
    render(<AppHeader />);
    const settings = screen.getByRole("button", { name: /open settings/i });
    fireEvent.click(settings);
    // DialogTitle renders as an accessible heading.
    expect(
      screen.getByRole("heading", { name: /^settings$/i }),
    ).toBeInTheDocument();
  });

  it("places the Settings button before the ThemeSwitcher in DOM order", () => {
    render(<AppHeader />);
    const settings = screen.getByRole("button", { name: /open settings/i });
    const theme = screen.getByRole("button", { name: /toggle theme/i });
    // Settings precedes Theme in document order (left-to-right layout).
    const position = settings.compareDocumentPosition(theme);
    // Node.DOCUMENT_POSITION_FOLLOWING = 4 → `theme` follows `settings`.
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// add-frameless-window-chrome — the header is now the window's unified title
// bar: the OS drag region, with a per-OS window-controls affordance on the
// right (custom on Windows/Linux, none on macOS where native traffic lights
// live). Platform is read from the preload bridge post-mount.
describe("AppHeader — window chrome (add-frameless-window-chrome)", () => {
  function stubApi(platform: string) {
    (window as unknown as { api: unknown }).api = {
      platform,
      window: {
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
        onMaximizeChange: vi.fn(() => () => {}),
      },
    };
  }

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("the header itself is the OS drag region", () => {
    const { container } = render(<AppHeader />);
    expect(container.querySelector("header")).toHaveClass("app-drag");
  });

  it("the settings button and theme switcher sit inside an app-no-drag region", () => {
    render(<AppHeader />);
    const settings = screen.getByRole("button", { name: /open settings/i });
    const theme = screen.getByRole("button", { name: /toggle theme/i });
    expect(settings.closest(".app-no-drag")).not.toBeNull();
    expect(theme.closest(".app-no-drag")).not.toBeNull();
  });

  it("renders custom window controls on Windows", async () => {
    stubApi("win32");
    render(<AppHeader />);
    expect(await screen.findByTestId("window-controls")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^minimize$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^maximize$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("renders custom window controls on Linux", async () => {
    stubApi("linux");
    render(<AppHeader />);
    expect(await screen.findByTestId("window-controls")).toBeInTheDocument();
  });

  it("renders NO custom controls on macOS and reserves left inset for the traffic lights", async () => {
    stubApi("darwin");
    render(<AppHeader />);
    const leftGroup = screen.getByText(/^CloudStash$/).closest("div");
    await waitFor(() => expect(leftGroup).toHaveClass("pl-20"));
    expect(screen.queryByTestId("window-controls")).toBeNull();
  });

  it("renders NO custom controls and no inset when there is no platform bridge", async () => {
    render(<AppHeader />);
    await waitFor(() =>
      expect(screen.getByText(/^CloudStash$/).closest("div")).not.toHaveClass(
        "pl-20",
      ),
    );
    expect(screen.queryByTestId("window-controls")).toBeNull();
  });
});
