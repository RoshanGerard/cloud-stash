## Context

Phase 1 (`add-failed-download-cleanup-affordance`, merged 2026-07-04) shipped the `downloads:delete-partial` primitive and a live failure toast that offers one-click "Delete partial". That affordance only exists while the toast is on screen. Once dismissed — or after an app restart — a KEPT partial file becomes an **orphan**: still on disk, but surfaced nowhere. This change adds the discovery surface Phase 1 deliberately deferred.

Current state (verified against the codebase):

- The durable `downloads` table (`services/fs-sync/src/db/schema.ts`) has columns `download_job_id (PK), datasource_id, source_path, target_path, bytes_downloaded, content_length, status ∈ {in-flight, completed, failed, cancelled, interrupted}, failure_tag, failure_message, started_at, updated_at, ended_at`. Indexes on `status` and `started_at`. **There is no disposition column** — the DB cannot tell, on its own, whether a failed download's partial is still on disk.
- Reads today: `downloads:list-active` (in-memory registry, in-flight only) and `downloads:clear-history` (pure-SQL row delete, never touches disk). **No RPC enumerates terminal rows.**
- `downloads:delete-partial { downloadJobId } → { deleted }` resolves `target_path` + `status` server-side, guards to `failed|cancelled|interrupted`, unlinks; ENOENT counts as success. Reusable **unchanged**.
- `clearDownloadHistory` (`downloads/clear-history.ts`) and `pruneDownloadHistory` (`downloads/prune.ts`) are two **separate** sync, pure-SQL delete paths — the first behind the manual `downloads:clear-history` command, the second behind the config-gated 24h `prune-scheduler`. Both are explicitly documented "structurally cannot touch on-disk files."
- Auto-prune defaults **ON**: `DEFAULT_RETENTION_SETTINGS = { autoPrune: true, retentionDays: 90 }`, applied whenever `config.json`'s `downloadHistory` is absent or malformed — i.e. for essentially every existing user. The scheduler prunes once **immediately on service start**, then every 24h.
- Settings → Downloads (`settings-dialog.tsx`) already hosts a Download-history subsection (auto-delete toggle, retention dropdown, Clear… → `ClearHistoryDialog`). No per-row list view exists.

Constraints: the renderer has **no filesystem access** — any "is the partial still on disk?" check must run service-side. The four-layer desktop bridge pattern (ipc-contracts → sync-service-desktop channel → main IPC handler → preload/window-api → renderer sync api) is fixed by every existing `downloads:*` command.

All architectural decisions below were resolved in a brainstorming pass and validated at advisor checkpoint #1.

## Goals / Non-Goals

**Goals:**

- Surface orphaned KEPT partials from past failures (failed/cancelled/interrupted, file still on disk) in a discoverable Settings surface, with per-row and bulk deletion.
- Reuse `downloads:delete-partial` unchanged for every file deletion.
- Close the orphan hole created by record-only pruning **without** introducing silent background file deletion.

**Non-Goals:**

- No server-side bulk-delete command — bulk is a client loop over the reused single primitive.
- No disposition column added to the `downloads` table — on-disk existence is determined by a live `stat`.
- No history-list view of *completed* downloads — this is a leftover-file cleanup surface, not a general history viewer.
- No change to `downloads:delete-partial` itself, nor to its desktop bridge (already shipped in Phase 1).
- Exact row layout, confirm-dialog styling, and final copy are set by the post-propose visual-refinement pass, not here.

## Decisions

### D1 — Scope: leftover files only, confirmed on disk service-side

The list shows ONLY `failed | cancelled | interrupted` rows whose `target_path` the service confirms still exists. The renderer cannot stat, so the read command stats each candidate and excludes ENOENT/errored rows. Completed downloads never appear (their `target_path` is a real saved file, not a leftover).

*Alternative rejected:* a general "download history" list rendered from DB rows without statting. Rejected — most rows wouldn't be cleanup-actionable, and without a stat we can't distinguish "orphan on disk" from "already gone," which is the entire point.

### D2 — New read command `downloads:list-leftover`

Request `{}`; response `{ ok: true, value: { entries: LeftoverEntry[] } }`. Handler is dispatched with `db` + an injected fs `stat` port (mirrors `downloads-delete-partial`'s injected `unlink` port). It selects KEEP-eligible terminal rows ordered by `ended_at` DESC, stats each `target_path`, and emits one `LeftoverEntry` per row whose file exists:

```
LeftoverEntry = {
  downloadJobId, datasourceId, sourcePath, targetPath,
  sizeOnDisk,        // from the stat (bytes actually on disk now)
  failureTag,        // nullable
  failureMessage,    // nullable
  endedAt            // nullable
}
```

Read-only; **never throws** — a per-row stat error (ENOENT or otherwise) means "not a live leftover" and the row is skipped. No pagination: the result is the failure subset, already bounded by retention, and further narrowed to files-still-present.

*Alternative rejected:* returning all terminal rows and letting the client filter — impossible, the client can't stat.

### D3 — Placement: a dedicated dialog opened from a count-bearing button

A "Review leftover files (N)" button in the Settings → Downloads section opens a focused `LeftoverFilesDialog` (mirrors the Clear… → `ClearHistoryDialog` pattern). The button shows the count and is hidden when N = 0 (nothing to review). The count is obtained by calling `downloads:list-leftover` when the Settings dialog opens; the dialog reuses/refreshes that result on open.

*Alternative rejected:* an always-visible inline list in the settings panel — bloats a preferences surface with a scrollable destructive list; awkward when many rows.

### D4 — Delete UX: per-row + bulk, both via the reused primitive

Each row has a Delete action calling `downloads:delete-partial { downloadJobId }`. A bulk "Delete all" (behind a confirmation) client-loops the same primitive over the shown `downloadJobId`s. The aggregate result **distinguishes deleted vs. failed per file** — one `EACCES` renders as "N deleted, M couldn't be removed," never "all cleared." `delete-partial` only unlinks the file and leaves the DB row; the next `list-leftover` read naturally excludes that row (its file is now gone).

*Alternative rejected:* a server-side bulk-delete command — more contract surface for a bounded set, and it would duplicate the guard logic already in `delete-partial`. Client-loop honors the Phase-1 "reuse unchanged" promise.

### D5 — Contract change, file deletion split by initiator: user-initiated paths delete files, the headless path does not

- **`clearDownloadHistory` (manual `downloads:clear-history`)** now unlinks the KEEP-eligible partial (`failed|cancelled|interrupted`) for every row in its computed delete set, **before** deleting the rows. Completed rows' saved files are never touched — the unlink is filtered to the KEEP-eligible subset even though the SQL DELETE still removes all matching terminal rows. Unlink is best-effort: ENOENT/EACCES are tolerated and never block the row deletion. Requires an injected fs port; the function reads the KEEP-eligible `target_path`s in the delete set (SELECT), unlinks them, then DELETEs.
- **`pruneDownloadHistory` (headless 24h scheduler)** never unlinks any file, AND now **skips deleting** any KEEP-eligible row whose partial is still on disk — statting the KEEP-eligible aged rows and excluding the ones whose file exists. It still deletes completed aged rows and KEEP-eligible aged rows whose file is already gone. Those skipped rows self-clean on a later tick once the user removes the file.

**Why headless-never-deletes over "prune also unlinks":** auto-prune is ON by default and its first tick fires on service start. If prune unlinked files, the first launch after this ships would silently mass-delete every user's aged leftover partials — new destructive behavior on pre-existing data, before anyone sees the new copy. Skipping the row (instead of background-deleting the file) achieves the same end (no stranded orphans, because the row stays discoverable) with a human in the loop for every actual deletion.

*Alternatives rejected:* (a) "document only, change nothing" — leaves the orphan hole open; (b) "prune also unlinks" — the silent first-run mass deletion above; (c) "reset the auto-prune toggle OFF on upgrade" — a migration plus loss of record-pruning until re-opt-in, more scope for a worse consent story than simply never deleting files headlessly.

Both functions were previously documented "structurally cannot touch on-disk files." That safety property is refined here; both now stat the disk. This is an Outcome-3 contract change, captured as MODIFIED requirements with explicit scenarios (the KEEP-eligible-only unlink filter and the prune-skip are pinned as scenarios so the two-site change is auditable).

### D6 — Copy

Clear-history dialog copy shifts from "on-disk files are NOT deleted" to "**Saved files are kept; incomplete leftover files are removed.**" The auto-delete toggle helper text clarifies it removes **records** (the headless path never deletes files), with leftover files reviewed under "Review leftover files." Exact wording is finalized in the visual-refinement pass; the *contract* (Clear… deletes leftover partials; the list is the file-cleanup surface) is fixed here.

## Risks / Trade-offs

- **[Enabling auto-prune no longer deletes any files in the background.]** → Intended. Every file deletion is now human-initiated (per-row, bulk, or manual Clear…). This is the deliberate trade for avoiding the silent first-run sweep; the "Auto-delete old history" toggle governs records only, disclosed in its copy.
- **[A KEEP-eligible row whose partial is on disk now outlives its retention window]** (prune skips it) until the user cleans it. → Intended — that is what keeps it discoverable. The row self-cleans on a later prune tick once the file is gone.
- **[`clearDownloadHistory` and `pruneDownloadHistory` now perform disk I/O]**, reversing a documented "pure-SQL, cannot touch files" property. → Mitigation: unlink is best-effort and filtered to KEEP-eligible rows only; completed files are provably never touched (explicit scenario). Prune remains crash-safe: a stat/unlink error degrades to "skip this row," never aborts the cycle (consistent with the scheduler's existing degrade-not-crash guard).
- **[TOCTOU between `list-leftover` and a delete]** — a file could vanish between listing and the delete click. → Already handled: `delete-partial` maps ENOENT to `{ deleted: true }`, so a since-removed file is a success, not an error.
- **[Statting on every Settings-dialog open]** to compute the button count. → The candidate set is small (failure subset, retention-bounded); the stat sweep is cheap and off the hot path. If it ever isn't, the count can move to a lazy/on-dialog-open fetch without a contract change.

## Migration Plan

Additive. The `downloads:list-leftover` command is net-new; no schema migration (no new columns — on-disk existence is computed by stat). The `clear-history` and prune behavior changes take effect on deploy with no data migration. No rollback data concerns: reverting the code restores the prior record-only behavior; no rows or files are mutated by the deploy itself (only by subsequent user actions / prune ticks).

## Open Questions

None blocking. The visual-refinement pass (below) settled row layout, bulk-confirm styling, results/empty-state behavior, and copy — all within the contract fixed above.

## Visual direction

Resolved in the post-propose visual-refinement pass (superpowers:brainstorming Visual Companion). Reuses shadcn/ui primitives (`Dialog`, `AlertDialog`, `Button`, `Icon`) + Tailwind, matching `settings-dialog.tsx` and `clear-history-dialog.tsx`. WCAG AA throughout; no bespoke motion (only Radix primitive transitions, per the motion budget). `rounded-lg` is permitted only on the dialog file (basename contains `dialog`), per the radii-ceiling guardrail.

### VD1 — Button placement & count

A "Review leftover files" control lives in the Settings → Downloads **Download-history subsection**, grouped with the record-management controls and sitting **directly above the "Clear download history" row** (the two cleanup actions read together). It shows the current count — e.g. "Review leftover files (3)" — and is **hidden entirely when the count is 0** (nothing to review). The count comes from a `downloads:list-leftover` call when the Settings dialog opens. Same row typography as the sibling rows (left label/description stack, right-aligned trigger `Button variant="outline" size="sm"`).

### VD2 — Dialog frame

`LeftoverFilesDialog` mirrors `ClearHistoryDialog`: `Dialog` → `DialogContent` (focus restored to the opening button via `onCloseAutoFocus` + `returnFocusTo`) → `DialogHeader` with title **"Leftover download files"** and description **"Incomplete files left on disk by past failed downloads. Deleting one removes it from your computer."** The list sits in the body; `DialogFooter` carries **"Delete all"** bottom-left (destructive, tinted) and **"Close"** bottom-right.

### VD3 — Row layout (combined vertical single-item list)

A full-width vertical list (`role="list"`), one item per entry (`role="listitem"`), inside a `rounded-lg` bordered container with row separators. Each item is a two-line stack:

- **Top line** (flex row): a leading file `Icon` (muted), the **file name** in `font-medium` (flex-1, `truncate` with the full `targetPath` as the `title` tooltip), the **on-disk size** right-aligned (`tabular-nums`, muted), and a **labelled Delete button** (trash `Icon` + the text "Delete", `size="sm"`, destructive tint) — a labelled control, never a color-only glyph.
- **Second line** (muted, `text-xs`, aligned under the name): the **failure reason · date**, e.g. "Failed · ran out of retries · 3 days ago" (reason derived from `failureTag`/`failureMessage`; date from `endedAt`).

### VD4 — Bulk "Delete all" confirmation

A nested shadcn **`AlertDialog`** opened by "Delete all", rendered over the dimmed list. Title names the count — **"Delete all N leftover files?"** — body: **"These incomplete files will be removed from your computer. This can't be undone."** Actions: **Cancel** and a destructive **"Delete N files"**. The AlertDialog supplies focus-trap + Escape handling. "Delete all" is disabled while a bulk operation is in flight.

### VD5 — Results & empty state

- **Per-row Delete:** on `{ deleted: true }` the row is removed immediately. On failure (e.g. `EACCES`) the row **stays** with an inline red "Couldn't delete: <reason>" and its Delete button remains to re-attempt.
- **Bulk Delete all:** succeeded rows vanish; any failed rows stay inline with their error. A Sonner **toast summarizes the aggregate** — "Deleted 4 files" on full success, "Deleted 4 · 1 couldn't be removed" on partial failure (never "all cleared" when any failed). Matches the app's toast-for-results convention (clear-history reports its count via toast).
- **Empty state:** when the list empties (all cleaned, one-by-one or via Delete all), the dialog shows a friendly empty state — **"You're all cleaned up — no leftover files."** — rather than snapping shut. The user closes it themselves.

### VD6 — Copy changes to existing surfaces

- `clear-history-dialog.tsx` safety note changes from "Files already saved … are **not** deleted — this only removes the history records." to **"Saved files are kept; incomplete leftover files are removed."** (Clear… now unlinks KEEP-eligible partials while leaving completed files.)
- The Settings **"Auto-delete old history"** toggle helper text is clarified to state it removes history **records** (not files on disk), and that leftover files are reviewed under **"Review leftover files."**

### VD7 — Accessibility

Semantic list markup (`role="list"` / `listitem`); every Delete control is labelled (icon + text or `aria-label`); destructive intent conveyed by label + shape, not color alone; the nested AlertDialog and the outer Dialog both trap focus and restore it on close; full keyboard reachability; WCAG AA contrast on the tinted destructive controls against their fixed fill.
