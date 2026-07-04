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

2. **Adaptive controls (custom Win/Linux, native mac).** On macOS the traffic lights are the platform-idiomatic controls and users expect them; re-drawing our own would be wrong. On Windows/Linux there is no inset control set, so we render custom minimize / maximize-restore / close buttons on the right of the header. The renderer detects platform via a preload-exposed `window.api.platform` (or the existing platform bridge) and conditionally renders `WindowControls`. Alternative (custom controls on all three) rejected — non-idiomatic on macOS.

3. **Unified title bar = the existing `AppHeader`.** The header IS the drag region (`-webkit-app-region: drag`); the wordmark, settings button, theme switcher, and window controls are each `-webkit-app-region: no-drag` so they remain clickable. This avoids a separate title strip stacked above the header (double chrome). On macOS, the left side reserves inset padding so the wordmark clears the traffic lights.

4. **Window controls reuse the `ping` four-layer IPC pattern.** `window:minimize` / `window:toggle-maximize` / `window:close` are `ipcMain` handlers with a typed contract in `@cloudstash/ipc-contracts`, a `contextBridge` binding `window.api.window.{minimize,toggleMaximize,close}`, and renderer call sites. A main→renderer push `window:maximize-change` (fired from the window's `'maximize'`/`'unmaximize'` events) lets the maximize button swap between maximize and restore glyphs. Alternative (renderer polls `isMaximized`) rejected — event push is cheaper and flicker-free.

5. **Accessibility.** Each custom control is a real `<button>` with an `aria-label` ("Minimize", "Maximize"/"Restore", "Close"), `:focus-visible` ring meeting WCAG 2.2 non-text contrast (3:1), and a glyph drawn as an SVG (currentColor) so it inherits the theme foreground. Close-button hover uses a red affordance but the glyph keeps AA contrast. Keyboard: buttons are in tab order after the theme switcher.

## Risks / Trade-offs

- **[Windows 11 Snap Layouts hover menu lost]** → Accepted and documented. Aero Snap via drag-to-edge and keyboard (Win+Arrow) still work under `titleBarStyle: 'hidden'`; only the maximize-button hover flyout is gone. Re-adding it needs `WCO`/custom non-client hit-testing — out of scope.
- **[Linux frameless resize depends on the window manager]** → `titleBarStyle: 'hidden'` retains resize under most WMs; on the minority that don't, users resize via WM shortcuts. Documented, not blocked.
- **[Drag-region CSS foot-guns]** → a `drag` region swallows clicks unless children are `no-drag`; every interactive header child must opt out. Covered by a test asserting `no-drag` on each control.
- **[window-options security test]** → the existing `window-options.test.ts` must be extended, not weakened; the four `webPreferences` flags stay asserted alongside the new `titleBarStyle`.
- **[Post-rename dependency]** → the window-controls contract imports `@cloudstash/ipc-contracts`; this change assumes `rebrand-to-cloudstash` is merged. If authored/applied before that, the import name is stale — pre-apply staleness check catches it.

## Visual direction

Small surface (three ~28px control buttons + drag region); the visual treatment is monochrome per the CloudStash identity and inherits theme tokens. Locked: adaptive per-OS, unified-with-header, real buttons + aria-labels, currentColor glyphs, red close-hover affordance at AA contrast. The only visual nuance is the control glyph/hover styling, which is minor and token-driven; a Visual Companion mockup pass is offered at review but there is no open visual fork here (unlike change 2's radii/density question).

## Open Questions

- None blocking. macOS inset padding width (to clear traffic lights) is an implementation constant tuned during apply; the maximize↔restore glyph pair is standard.
