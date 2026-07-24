## MODIFIED Requirements

### Requirement: Settings → Downloads offers a Review-leftover-files affordance

The Settings → Downloads section (`settings-dialog.tsx`) SHALL gain a "Review leftover files" affordance that lets the user discover and delete orphaned KEPT partial files from past downloads that did not finish (dismissed toasts / prior sessions). The affordance SHALL comprise a count-bearing button and a dedicated dialog, using the same heading-and-row typography and keyboard/focus behavior as the existing Downloads rows, and SHALL meet WCAG AA (labelled controls, keyboard reachable, destructive intent conveyed non-visually).

- **Button** — a control labelled "Review leftover files" that displays the current leftover count (e.g. "Review leftover files (3)") and SHALL be hidden when the count is zero (nothing to review). The count SHALL be obtained by calling `downloads:list-leftover` when the Settings dialog opens.
- **Dialog** — activating the button SHALL open a focused dialog (mirroring the existing Clear… → `ClearHistoryDialog` pattern, including focus restoration to the opening button) that lists each leftover entry returned by `downloads:list-leftover` with, per row, at least the file name, its on-disk size, and the row's reason. The dialog SHALL provide a **per-row Delete** action and a **bulk "Delete all"** action.

The per-row reason SHALL reflect that row's actual terminal disposition as carried by the entry's `status` (`failed`, `cancelled`, or `interrupted`). A row SHALL NOT be described as a failure unless its `status` is `failed`; in particular a cancelled or interrupted row SHALL NOT be labelled "Download failed". The reason SHALL lead with a human-readable label for the disposition, followed by any recorded failure detail (`failureMessage`, else a humanized `failureTag`) when one exists, followed by the relative time derived from `endedAt` when it is non-null. Because `status` is required on every entry, the renderer SHALL NOT fall back to a generic failure label for an unlabelled row. The renderer SHALL derive this display text from the machine-readable `status`; the service SHALL NOT supply pre-composed prose for it.

Any copy in this affordance that characterizes the collection as a whole — including the dialog's description — SHALL describe the listed files as downloads that did not finish, rather than as failed downloads, since the list deliberately spans failed, cancelled, and interrupted rows.

The renderer SHALL reach `downloads:list-leftover` and `downloads:delete-partial` through the preload `window.api.sync` surface (mirroring the existing `downloads:*` bridges). Per-row Delete SHALL dispatch `downloads:delete-partial { downloadJobId }` for that row; on success the row SHALL be removed from the list. Bulk "Delete all" SHALL be guarded by a destructive-confirm step and SHALL delete every listed file by dispatching `downloads:delete-partial` for each shown `downloadJobId`; the outcome SHALL be reported as an aggregate that distinguishes deleted vs. failed counts — a single failure (e.g. `EACCES`) SHALL NOT be reported as "all cleared." Deleting a file removes it from disk but leaves the `downloads` record; the entry disappears from the list because a subsequent `downloads:list-leftover` excludes rows whose file is gone.

#### Scenario: Button shows the leftover count and opens the dialog

- **WHEN** the user opens Settings and `downloads:list-leftover` returns 3 entries
- **THEN** the Downloads section shows a "Review leftover files (3)" button; activating it opens a dialog listing the 3 entries, each with its file name, on-disk size, and reason

#### Scenario: A cancelled row is not described as a failure

- **WHEN** the dialog lists an entry whose `status` is `cancelled` and whose `failureTag` and `failureMessage` are both null
- **THEN** that row's reason identifies it as cancelled and does NOT read "Download failed"

#### Scenario: An interrupted row is distinguished from a cancelled one

- **WHEN** the dialog lists one entry whose `status` is `interrupted` and one whose `status` is `cancelled`, neither carrying a `failureTag` or `failureMessage`
- **THEN** the two rows show different reasons, each naming its own disposition

#### Scenario: A failed row still surfaces its recorded detail

- **WHEN** the dialog lists an entry whose `status` is `failed` and whose `failureMessage` is "ran out of retries"
- **THEN** that row's reason identifies it as failed AND includes the recorded detail "ran out of retries"

#### Scenario: Button is hidden when there are no leftovers

- **WHEN** the user opens Settings and `downloads:list-leftover` returns 0 entries
- **THEN** the "Review leftover files" button is not shown

#### Scenario: Per-row delete removes the file and the row

- **WHEN** the user clicks Delete on a leftover row
- **THEN** the renderer dispatches `downloads:delete-partial { downloadJobId }` for that row; on `{ deleted: true }` the row is removed from the list

#### Scenario: Bulk delete-all confirms and reports a deleted-vs-failed aggregate

- **WHEN** the user activates "Delete all", confirms the destructive step, and one of the shown files fails to delete (e.g. `EACCES`) while the rest succeed
- **THEN** the renderer dispatches `downloads:delete-partial` for each shown `downloadJobId`; the result is reported as an aggregate distinguishing the number deleted from the number that failed — it is NOT reported as "all cleared"
