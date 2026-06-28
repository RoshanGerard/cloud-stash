## ADDED Requirements

### Requirement: Settings Downloads section includes download-history retention controls

The `SettingsDialog` Downloads section (`settings-dialog.tsx`) SHALL gain download-history management controls below the existing rows, using the same heading-and-row typography and keyboard/focus behavior as the existing Motion / Explorer / Downloads rows:

- **Auto-prune toggle** — a `Switch` (the same shadcn primitive as the Motion and Always-ask rows) bound to `downloadHistory.autoPrune`, with disclosure helper text stating that history older than the selected window is automatically deleted. Reads and writes through the service config (see "Renderer config writes preserve existing config via read-modify-write").
- **Retention window** — a `DropdownMenuRadioGroup` (the same pattern as the Explorer page-size selector) offering exactly `30`, `90`, `180`, `365` days, bound to `downloadHistory.retentionDays`, defaulting to `90`. The selector SHALL be visually dimmed and non-interactive when auto-prune is off.
- **Clear download history** — a control that performs a FILTERED clear honoring the full backend filter contract (all / by-status / by-age), dispatching `downloads:clear-history` with the chosen `{ status?, olderThanMs? }`. Activating it SHALL open a destructive-confirm dialog whose copy explicitly states that on-disk files are NOT deleted (only the records). On confirm, the renderer SHALL report the returned `{ deleted }` count via a toast.

The controls SHALL meet WCAG AA (labelled controls, keyboard reachable, dimmed-state conveyed non-visually). Exact layout is set by the change's visual-direction.

#### Scenario: Auto-prune toggle reflects and writes service config

- **WHEN** the user opens Settings and `downloadHistory.autoPrune` is `true` in service config, then toggles it off
- **THEN** the Switch renders on initially, and toggling writes `downloadHistory.autoPrune: false` through the config helper (preserving `providers`)

#### Scenario: Retention window is dimmed when auto-prune is off

- **WHEN** the Settings Downloads section renders with `downloadHistory.autoPrune: false`
- **THEN** the retention-window selector is dimmed and non-interactive; enabling auto-prune re-enables it

#### Scenario: Retention window writes the selected preset

- **WHEN** auto-prune is on and the user selects `180` from the retention-window selector
- **THEN** the renderer writes `downloadHistory.retentionDays: 180` through the config helper; the selector offers only `30 / 90 / 180 / 365`

#### Scenario: Clear history confirms, clears with the chosen filter, and reports the count

- **WHEN** the user activates "Clear download history", chooses a filter (e.g. failed + interrupted), and confirms the destructive dialog
- **THEN** the dialog copy states that on-disk files are not deleted; the renderer dispatches `downloads:clear-history { filter: { status: ["failed", "interrupted"] } }`; on the `{ deleted: N }` response a toast reports N records cleared

### Requirement: Renderer config writes preserve existing config via read-modify-write

Renderer writes to the service config SHALL be read-modify-write: a dedicated helper SHALL `sync:get-config`, spread-merge the changed field into the returned `ServiceConfig`, and `sync:set-config` the merged result, preserving `schemaVersion` and the existing `providers`. The renderer SHALL NOT construct a fresh `ServiceConfig` for a partial update, because `sync:set-config` overwrites `config.json` wholesale and a fresh object would drop the OAuth app secrets in `providers`.

#### Scenario: Writing downloadHistory preserves OAuth provider secrets

- **WHEN** service config is `{ schemaVersion: 1, providers: { "google-drive": { clientId: "X", clientSecret: "Y" } } }` and the user changes a download-history setting
- **THEN** the helper reads the current config, merges only `downloadHistory`, and writes back `{ schemaVersion: 1, providers: { "google-drive": { clientId: "X", clientSecret: "Y" } }, downloadHistory: {…} }` — the `providers` entry is unchanged

#### Scenario: Concurrent-safe merge uses the latest read

- **WHEN** the helper performs a write
- **THEN** it bases the merge on a fresh `sync:get-config` immediately before `sync:set-config`, not on a stale cached copy

### Requirement: Desktop bridges service config and clear-history to the renderer

The desktop main process SHALL expose `sync:get-config`, `sync:set-config`, and `downloads:clear-history` to the renderer via a main-process IPC handler and a preload `window.api` surface, forwarding to the service over the existing supervisor client (mirroring the existing `downloads:list-active` bridge). This is the first renderer exposure of `sync:get-config` / `sync:set-config` (previously wired only at the desktop↔service channel map for a future settings UI).

#### Scenario: Renderer can round-trip config through the bridge

- **WHEN** the renderer calls the preload `getConfig` then `setConfig` with a merged config
- **THEN** the main process forwards each to the service's `sync:get-config` / `sync:set-config` and returns the service response to the renderer

#### Scenario: Renderer can dispatch clear-history through the bridge

- **WHEN** the renderer calls the preload `clearDownloadHistory({ status: ["failed"] })`
- **THEN** the main process forwards `downloads:clear-history { filter: { status: ["failed"] } }` to the service and returns `{ deleted: N }` to the renderer
