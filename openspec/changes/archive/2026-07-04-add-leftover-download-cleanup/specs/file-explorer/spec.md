## ADDED Requirements

### Requirement: Settings → Downloads offers a Review-leftover-files affordance

The Settings → Downloads section (`settings-dialog.tsx`) SHALL gain a "Review leftover files" affordance that lets the user discover and delete orphaned KEPT partial files from past download failures (dismissed toasts / prior sessions). The affordance SHALL comprise a count-bearing button and a dedicated dialog, using the same heading-and-row typography and keyboard/focus behavior as the existing Downloads rows, and SHALL meet WCAG AA (labelled controls, keyboard reachable, destructive intent conveyed non-visually).

- **Button** — a control labelled "Review leftover files" that displays the current leftover count (e.g. "Review leftover files (3)") and SHALL be hidden when the count is zero (nothing to review). The count SHALL be obtained by calling `downloads:list-leftover` when the Settings dialog opens.
- **Dialog** — activating the button SHALL open a focused dialog (mirroring the existing Clear… → `ClearHistoryDialog` pattern, including focus restoration to the opening button) that lists each leftover entry returned by `downloads:list-leftover` with, per row, at least the file name, its on-disk size, and the failure reason. The dialog SHALL provide a **per-row Delete** action and a **bulk "Delete all"** action.

The renderer SHALL reach `downloads:list-leftover` and `downloads:delete-partial` through the preload `window.api.sync` surface (mirroring the existing `downloads:*` bridges). Per-row Delete SHALL dispatch `downloads:delete-partial { downloadJobId }` for that row; on success the row SHALL be removed from the list. Bulk "Delete all" SHALL be guarded by a destructive-confirm step and SHALL delete every listed file by dispatching `downloads:delete-partial` for each shown `downloadJobId`; the outcome SHALL be reported as an aggregate that distinguishes deleted vs. failed counts — a single failure (e.g. `EACCES`) SHALL NOT be reported as "all cleared." Deleting a file removes it from disk but leaves the `downloads` record; the entry disappears from the list because a subsequent `downloads:list-leftover` excludes rows whose file is gone.

#### Scenario: Button shows the leftover count and opens the dialog

- **WHEN** the user opens Settings and `downloads:list-leftover` returns 3 entries
- **THEN** the Downloads section shows a "Review leftover files (3)" button; activating it opens a dialog listing the 3 entries, each with its file name, on-disk size, and failure reason

#### Scenario: Button is hidden when there are no leftovers

- **WHEN** the user opens Settings and `downloads:list-leftover` returns 0 entries
- **THEN** the "Review leftover files" button is not shown

#### Scenario: Per-row delete removes the file and the row

- **WHEN** the user clicks Delete on a leftover row
- **THEN** the renderer dispatches `downloads:delete-partial { downloadJobId }` for that row; on `{ deleted: true }` the row is removed from the list

#### Scenario: Bulk delete-all confirms and reports a deleted-vs-failed aggregate

- **WHEN** the user activates "Delete all", confirms the destructive step, and one of the shown files fails to delete (e.g. `EACCES`) while the rest succeed
- **THEN** the renderer dispatches `downloads:delete-partial` for each shown `downloadJobId`; the result is reported as an aggregate distinguishing the number deleted from the number that failed — it is NOT reported as "all cleared"

## MODIFIED Requirements

### Requirement: Settings Downloads section includes download-history retention controls

The `SettingsDialog` Downloads section (`settings-dialog.tsx`) SHALL gain download-history management controls below the existing rows, using the same heading-and-row typography and keyboard/focus behavior as the existing Motion / Explorer / Downloads rows:

- **Auto-prune toggle** — a `Switch` (the same shadcn primitive as the Motion and Always-ask rows) bound to `downloadHistory.autoPrune`, with disclosure helper text stating that download-history **records** older than the selected window are automatically deleted, and that this never deletes files on disk — leftover files are handled under "Review leftover files". Reads and writes through the service config (see "Renderer config writes preserve existing config via read-modify-write").
- **Retention window** — a `DropdownMenuRadioGroup` (the same pattern as the Explorer page-size selector) offering exactly `30`, `90`, `180`, `365` days, bound to `downloadHistory.retentionDays`, defaulting to `90`. The selector SHALL be visually dimmed and non-interactive when auto-prune is off.
- **Clear download history** — a control that performs a FILTERED clear honoring the full backend filter contract (all / by-status / by-age), dispatching `downloads:clear-history` with the chosen `{ status?, olderThanMs? }`. Activating it SHALL open a destructive-confirm dialog whose copy explicitly states that saved (completed) files are kept while incomplete leftover files are removed. On confirm, the renderer SHALL report the returned `{ deleted }` count via a toast.

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
- **THEN** the dialog copy states that saved files are kept while incomplete leftover files are removed; the renderer dispatches `downloads:clear-history { filter: { status: ["failed", "interrupted"] } }`; on the `{ deleted: N }` response a toast reports N records cleared
