## ADDED Requirements

### Requirement: Main window is frameless with a custom unified title bar

The main `BrowserWindow` SHALL be constructed without the native OS title bar, using `titleBarStyle: 'hidden'` on Windows and Linux and `titleBarStyle: 'hiddenInset'` on macOS. The window SHALL retain native resize borders and OS snap behavior (drag-to-edge / keyboard snap); the four hardened `webPreferences` flags (`contextIsolation`, `nodeIntegration: false`, `sandbox`, `webSecurity`) SHALL remain unchanged. The renderer's persistent app header SHALL serve as the unified title bar: the header container SHALL be marked `-webkit-app-region: drag`, and every interactive child (wordmark link if any, settings button, theme switcher, window controls) SHALL be marked `-webkit-app-region: no-drag`. On Windows and Linux the header SHALL render custom window controls (minimize, maximize-restore, close); on macOS it SHALL NOT render custom controls and SHALL reserve left inset padding so the wordmark clears the native traffic lights. There SHALL be exactly one title bar surface (no native frame AND no second custom strip above the header).

#### Scenario: Windows/Linux window is frameless with hidden title bar

- **WHEN** the main window is created on Windows or Linux
- **THEN** `buildMainWindowOptions(...)` returns options with `titleBarStyle: 'hidden'`, no native menu/title strip is shown, native resize borders remain functional, and the four hardened `webPreferences` flags are still present

#### Scenario: macOS keeps native traffic lights, no custom buttons

- **WHEN** the main window is created on macOS
- **THEN** the options use `titleBarStyle: 'hiddenInset'`, the native traffic-light controls are visible and functional, the renderer does NOT render custom minimize/maximize/close buttons, and the header reserves left inset so the wordmark does not overlap the traffic lights

#### Scenario: Header is the OS drag region with non-drag controls

- **WHEN** a Vitest/jsdom test renders the app header
- **THEN** the header root element carries a `-webkit-app-region: drag` style (or equivalent class), and each interactive control (settings button, theme switcher, and — on Windows/Linux — each window-control button) carries `-webkit-app-region: no-drag`

### Requirement: Window controls IPC drives minimize, maximize-restore, and close

The renderer SHALL control the main window through a four-layer IPC surface mirroring the `ping` pattern: (1) `ipcMain` handlers for `window:minimize`, `window:toggle-maximize`, and `window:close` under `apps/desktop/src/main/ipc/`; (2) a typed contract in `@cloudstash/ipc-contracts` describing each command; (3) a `contextBridge.exposeInMainWorld` binding exposing `window.api.window.minimize()`, `window.api.window.toggleMaximize()`, and `window.api.window.close()`; (4) typed renderer call sites on the custom control buttons. The main process SHALL additionally push a `window:maximize-change` event to the renderer whenever the window emits `'maximize'` or `'unmaximize'`, and the renderer SHALL subscribe (e.g. `window.api.window.onMaximizeChange`) so the maximize control swaps between a maximize glyph and a restore glyph to match the current state. The custom controls SHALL be real `<button>` elements with `aria-label`s ("Minimize", "Maximize"/"Restore", "Close") and a `:focus-visible` ring meeting WCAG 2.2 non-text contrast (3:1) in both themes.

#### Scenario: Minimize, toggle-maximize, and close invoke the window

- **WHEN** the user activates the minimize, maximize-restore, or close control (click or keyboard)
- **THEN** the renderer calls `window.api.window.minimize()` / `toggleMaximize()` / `close()` respectively, the preload forwards via `ipcRenderer.invoke`/`send`, and the main handler calls the corresponding `BrowserWindow` method (`minimize()`, `maximize()`/`unmaximize()`, `close()`)

#### Scenario: Maximize-change event updates the control glyph

- **WHEN** the window becomes maximized or is restored (via the control, a double-click, or an OS snap)
- **THEN** the main process emits `window:maximize-change` with the new maximized boolean, the renderer receives it, and the maximize-restore control renders the restore glyph when maximized and the maximize glyph when not

#### Scenario: Controls are keyboard-accessible and labelled

- **WHEN** a test tabs to each window control and inspects it
- **THEN** each control is a `<button>` with an `aria-label` ("Minimize", "Maximize" or "Restore", "Close"), is reachable by keyboard, activates on Enter/Space, and shows a `:focus-visible` ring whose contrast against the header background meets WCAG 2.2 non-text contrast (3:1)
