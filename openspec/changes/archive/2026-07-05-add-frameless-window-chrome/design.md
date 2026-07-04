## Context

The main window is created by `buildMainWindowOptions(preloadPath)` in `apps/desktop/src/main/window-options.ts` with the default native frame and the four hardened `webPreferences` flags (asserted by `__tests__/window-options.test.ts`). The renderer already mounts a persistent `AppHeader` (a 48px / `h-12` bar with the wordmark on the left and settings + theme switcher on the right) once in the root layout. This change turns that header into the window's title bar and removes the native frame. IPC in this app follows the `ping` four-layer pattern (main handler → `ipc-contracts` typed contract → preload `contextBridge` → renderer call site), which the window controls reuse.

## Goals / Non-Goals

**Goals:**
- A frameless main window that keeps native resize + snap behavior on each OS.
- A single unified title bar (the app header) — no double chrome, no separate title strip.
- Adaptive controls: custom buttons on Windows/Linux, native traffic lights on macOS.
- Window controls that are real, keyboard-accessible buttons meeting WCAG AA.
- Zero change to the security posture (hardened `webPreferences` stand).

**Non-Goals:**
- Palette/visual restyle (change 2). This change is structural chrome only; it inherits the current theme.
- A custom OS-menu / global menu bar, custom resize handles, or re-implementing Aero Snap.
- Multi-window or per-window title bars (still a single main window).
- A boot splash window (separate optional change).

## Decisions

1. **`titleBarStyle` per platform, not `frame: false` everywhere.** Windows/Linux use `titleBarStyle: 'hidden'` (Electron keeps the resize borders and, on Windows, Aero Snap via the OS non-client area) rather than `frame: false` (which drops resize borders and would force us to re-implement hit-testing). macOS uses `'hiddenInset'` so the native traffic lights remain and sit inset into our header. Rationale: maximal native behavior retained for minimal custom code. Alternative (`frame: false` + custom resize hit-testing) rejected as high-risk and redundant with OS behavior.

2. **Adaptive controls (custom Win/Linux, native mac).** On macOS the traffic lights are the platform-idiomatic controls and users expect them; re-drawing our own would be wrong. On Windows/Linux there is no inset control set, so we render custom minimize / maximize-restore / close buttons on the right of the header. The renderer detects platform via a preload-exposed `window.api.platform` and conditionally renders `WindowControls`. **Refinement (apply-time staleness check):** there is no pre-existing platform bridge on `window.api` — this change ADDS one. It is exposed as a synchronous *static value* (`platform: process.platform`, available in the sandboxed preload) rather than an async getter, so `WindowControls` can branch at first render with no pop-in. Renderer call sites guard `window.api?.platform` (jsdom has no bridge). Alternative (custom controls on all three) rejected — non-idiomatic on macOS.

3. **Unified title bar = the existing `AppHeader`.** The header IS the drag region (`-webkit-app-region: drag`); the wordmark, settings button, theme switcher, and window controls are each `-webkit-app-region: no-drag` so they remain clickable. This avoids a separate title strip stacked above the header (double chrome). On macOS, the left side reserves inset padding so the wordmark clears the traffic lights.

4. **Window controls reuse the `ping` four-layer IPC pattern.** `window:minimize` / `window:toggle-maximize` / `window:close` are `ipcMain` handlers with a typed contract in `@cloudstash/ipc-contracts`, a `contextBridge` binding `window.api.window.{minimize,toggleMaximize,close}`, and renderer call sites. A main→renderer push `window:maximize-change` (fired from the window's `'maximize'`/`'unmaximize'` events) lets the maximize button swap between maximize and restore glyphs. Alternative (renderer polls `isMaximized`) rejected — event push is cheaper and flicker-free.

5. **Accessibility.** Each custom control is a real `<button>` with an `aria-label` ("Minimize", "Maximize"/"Restore", "Close"), `:focus-visible` ring meeting WCAG 2.2 non-text contrast (3:1), and a glyph drawn as an SVG (currentColor) so it inherits the theme foreground. Close-button hover uses a red affordance but the glyph keeps AA contrast. Keyboard: buttons are in tab order after the theme switcher.

6. **Close-hover token rule (visual-refinement resolution).** Close-hover fill = `--destructive`; on hover the glyph flips to `--destructive-foreground` (not the inherited foreground). This is load-bearing for AA: the dark theme's `--destructive` is a *soft* red (`#F87171`), on which a white glyph would fail AA — the token pair puts a near-black glyph (`#0B1016`) there instead, and white (`#FFFFFF`) on light's saturated `#DC2626`. Both clear AA by construction because the theme already defines the matching `--destructive-foreground`. Minimize/maximize/restore hover uses the neutral `--accent`/hover surface (no color). Verified with the change-2 oklch→luminance tooling during apply.

7. **Caption-button footprint = corner-flush, full header height (visual-refinement resolution).** The three controls run the full 48px header height and sit flush to the top-right corner / window edge (close touches the corner), grouped after a hairline divider following the settings + theme buttons. This maximizes the corner hit target (Fitts's law — slam-to-corner to close/maximize), matching the frameless-app convention (VS Code / Linear). This refines the proposal's provisional "~28px" sizing note toward better ergonomics; the compact ~28px icon-button alternative (matching the settings/theme footprint) was shown in the review mockup and rejected for the smaller, non-edge-reaching target. Glyphs, tokens, aria-labels, and focus ring are unchanged by this choice — only the button box differs. User-confirmed at visual review.

## Risks / Trade-offs

- **[Windows 11 Snap Layouts hover menu lost]** → Accepted and documented. Aero Snap via drag-to-edge and keyboard (Win+Arrow) still work under `titleBarStyle: 'hidden'`; only the maximize-button hover flyout is gone. Re-adding it needs `WCO`/custom non-client hit-testing — out of scope.
- **[Linux frameless resize depends on the window manager]** → `titleBarStyle: 'hidden'` retains resize under most WMs; on the minority that don't, users resize via WM shortcuts. Documented, not blocked.
- **[Drag-region CSS foot-guns]** → a `drag` region swallows clicks unless children are `no-drag`; every interactive header child must opt out. Covered by a test asserting `no-drag` on each control.
- **[window-options security test]** → the existing `window-options.test.ts` must be extended, not weakened; the four `webPreferences` flags stay asserted alongside the new `titleBarStyle`.
- **[Post-rename dependency]** → the window-controls contract imports `@cloudstash/ipc-contracts`; this change assumes `rebrand-to-cloudstash` is merged. If authored/applied before that, the import name is stale — pre-apply staleness check catches it.

## Visual direction

Small surface (three caption controls + drag region); the visual treatment is monochrome per the CloudStash identity and inherits theme tokens. Locked: adaptive per-OS, unified-with-header, real buttons + aria-labels, currentColor glyphs.

**Visual-refinement pass completed (2026-07-05).** A Visual Companion mockup rendered the unified title bar in both CloudStash themes with every control state (default / hover / focus, maximize↔restore, red close-hover) and the macOS-adaptive variant. Two nuances surfaced and were resolved (now Decisions 6 & 7):
- **Close-hover token rule** (Decision 6): fill `--destructive` + glyph `--destructive-foreground` — AA-clean in both themes by construction (a plain white-on-soft-red would fail on the dark theme).
- **Footprint** (Decision 7): **corner-flush, full header height** — user-confirmed at review over the compact ~28px alternative, for the corner hit-target ergonomics.

Glyphs: minimize = low horizontal bar; maximize = single rounded square; restore = two offset squares; close = X. Stroke `currentColor`, ~11px in the 48px×~42px button. No open visual fork remains.

## Open Questions

- None blocking. macOS inset padding width (to clear traffic lights) is an implementation constant tuned during apply; the maximize↔restore glyph pair is standard.
