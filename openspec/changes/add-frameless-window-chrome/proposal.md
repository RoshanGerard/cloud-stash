## Why

CloudStash should present as a modern, unified desktop surface rather than a web view inside a stock OS window. This change removes the native OS title bar and gives the app its own frameless window with a custom title bar merged into the existing app header, including window controls (minimize / maximize-restore / close). It is change 3 of the CloudStash program (rename → restyle → window-chrome) and depends on `rebrand-to-cloudstash` being merged (it wires window-control IPC through `@cloudstash/ipc-contracts`).

## What Changes

- The main `BrowserWindow` is constructed **frameless / hidden-title-bar**: `titleBarStyle: 'hidden'` on Windows/Linux (keeps resize borders + Aero Snap), `titleBarStyle: 'hiddenInset'` on macOS (keeps the native traffic-light controls, inset).
- The renderer's `AppHeader` becomes the **unified title bar**: it is the OS drag region (`-webkit-app-region: drag`) with all interactive controls marked `no-drag`, and — on Windows/Linux only — it renders custom minimize / maximize-restore / close buttons. On macOS the native traffic lights occupy the inset and no custom buttons render (**adaptive**).
- New **window-controls IPC** wired four-layer like `ping`: `window:minimize`, `window:toggle-maximize`, `window:close`, plus a main→renderer `window:maximize-change` push so the maximize button swaps to a restore glyph when the window's maximized state changes. Exposed as `window.api.window.*`.
- **Known tradeoff:** the Windows 11 Snap Layouts hover menu is unavailable with a hidden title bar (documented, accepted).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `app-shell`: adds two requirements — a frameless main window with a custom unified title bar (adaptive per-OS), and a window-controls IPC round-trip (minimize / maximize-restore / close + maximize-change). No existing requirement's behavior changes (security defaults, single-window, ping, renderer import bans all stand).

## Impact

- **Affected code**: `apps/desktop/src/main/window-options.ts` (add `titleBarStyle` per platform), main-process IPC handlers (`apps/desktop/src/main/ipc/`), `packages/ipc-contracts/` (new window-controls contract), preload `contextBridge` binding, and the renderer `AppHeader` (drag region + custom controls) + a small `WindowControls` component.
- **Dependencies**: none new. Requires `rebrand-to-cloudstash` merged (post-rename `@cloudstash/*` names).
- **Out of scope**: the monochrome restyle (`restyle-cloudstash-monochrome`, change 2) — this change keeps whatever palette is current; a boot splash (`add-cloudstash-splash`, optional/later); any change to the security `webPreferences` defaults.
