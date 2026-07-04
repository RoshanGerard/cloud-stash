"use client";

// add-frameless-window-chrome — custom caption controls for the frameless main
// window on Windows/Linux (macOS keeps its native traffic lights; AppHeader
// gates the render per platform). Real <button>s with aria-labels + currentColor
// SVG glyphs, driven through the `window.api.window.*` four-layer IPC. The
// maximize control swaps to a Restore glyph when the main process pushes a
// `window:maximize-change` event (event-driven, not a poll, so it stays
// flicker-free even on double-click / OS-snap state changes).
//
// Sizing (design.md Decision 7): each button is full header height (h-12) and
// 42px wide, flush to the top-right corner so the corner is a large hit target.
// Contrast (design.md Decision 6, verified oklch→luminance): default glyph =
// --foreground; minimize/maximize hover = --accent surface; close hover =
// --destructive fill with the glyph flipped to --destructive-foreground — that
// pair clears WCAG AA in BOTH themes (a plain white glyph would fail on the
// dark theme's soft red). The focus ring is the theme --ring at 3:1 non-text.

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const CAP_BASE =
  "app-no-drag flex h-12 w-[42px] items-center justify-center text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function MinimizeGlyph() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="1.5" y1="6" x2="8.5" y2="6" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.5" y="1.5" width="7" height="7" rx="0.6" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.4" y="3.1" width="5.5" height="5.5" rx="0.5" />
      <path d="M3.5 3.1 V1.4 H8.6 V6.5 H6.9" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="1.9" y1="1.9" x2="8.1" y2="8.1" />
      <line x1="8.1" y1="1.9" x2="1.9" y2="8.1" />
    </svg>
  );
}

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Subscribe to the main→renderer maximize-change push; the returned dispose
    // fn removes this listener on unmount. Optional-chained so a missing bridge
    // (jsdom / non-Electron) is a harmless no-op.
    const dispose = window.api?.window?.onMaximizeChange?.((maximized) => {
      setIsMaximized(maximized);
    });
    return dispose;
  }, []);

  const controls = () => window.api?.window;

  return (
    <div className="flex items-stretch" data-testid="window-controls">
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => controls()?.minimize()}
        className={cn(CAP_BASE, "hover:bg-accent")}
      >
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        onClick={() => controls()?.toggleMaximize()}
        className={cn(CAP_BASE, "hover:bg-accent")}
      >
        {isMaximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => controls()?.close()}
        className={cn(
          CAP_BASE,
          "hover:bg-destructive hover:text-destructive-foreground",
        )}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
