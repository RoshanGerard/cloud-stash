## 1. Pre-flight (post-rename dependency)

- [ ] 1.1 Confirm `rebrand-to-cloudstash` is merged; worktree at `.worktrees/add-frameless-window-chrome/` off the post-rename `master`; `pnpm install`.
- [ ] 1.2 Pre-apply staleness check: verify `window-options.ts`, `AppHeader`, the `ipc-contracts` layout, and `@cloudstash/*` names still match `design.md`.

## 2. Frameless window (main)

- [ ] 2.1 Extend `buildMainWindowOptions` to set `titleBarStyle: 'hidden'` on Windows/Linux and `'hiddenInset'` on macOS (platform-branched); keep the four hardened `webPreferences` flags.
- [ ] 2.2 Extend `__tests__/window-options.test.ts`: assert the per-platform `titleBarStyle` AND that all four security flags remain (no weakening).

## 3. Window-controls IPC (four-layer, like `ping`)

- [ ] 3.1 Add the window-controls contract to `@cloudstash/ipc-contracts` (`window:minimize`, `window:toggle-maximize`, `window:close`, `window:maximize-change` payload).
- [ ] 3.2 Add `ipcMain` handlers under `apps/desktop/src/main/ipc/` calling `BrowserWindow` `minimize()` / `maximize()`↔`unmaximize()` / `close()`; wire `'maximize'`/`'unmaximize'` window events to push `window:maximize-change`.
- [ ] 3.3 Add the preload `contextBridge` binding `window.api.window.{minimize,toggleMaximize,close,onMaximizeChange}`; extend the preload contract type test.
- [ ] 3.4 Unit/contract tests green (handlers invoked, maximize-change round-trip, contract type assertions).

## 4. Unified title bar + controls (renderer)

- [ ] 4.1 Make `AppHeader` the drag region (`-webkit-app-region: drag`); mark wordmark/settings/theme-switcher `no-drag`; reserve macOS left inset for traffic lights.
- [ ] 4.2 Add a `WindowControls` component (minimize / maximize-restore / close) — real `<button>`s, `aria-label`s, currentColor SVG glyphs, `:focus-visible` ring, red close-hover at AA contrast; render ONLY on Windows/Linux (platform-gated via the preload platform bridge).
- [ ] 4.3 Subscribe to `onMaximizeChange`; swap the maximize control between maximize/restore glyphs.
- [ ] 4.4 Component tests: drag/no-drag regions, platform-gated rendering (no custom buttons on macOS), aria-labels + keyboard activation, glyph swap on maximize-change.

## 5. Verify

- [ ] 5.1 `pnpm typecheck` + `pnpm lint` + `pnpm test` (`pnpm abi:node`) green.
- [ ] 5.2 e2e/manual on a running system: window is frameless, drag works, min/max/restore/close work, macOS shows native traffic lights + no custom buttons, Windows/Linux show custom controls; WCAG focus/contrast spot-check in both themes.
- [ ] 5.3 `openspec validate add-frameless-window-chrome` green; `openspec validate app-shell --type spec` green after sync.
