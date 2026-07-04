## Why

When a download fails and leaves a KEPT partial on disk, Phase 1's failure toast offers a one-click "Delete partial" — but only while that toast is live. Once it's dismissed or the app restarts, the partial becomes an **orphan**: it still occupies disk, but nothing surfaces it. Orphans accumulate silently across sessions with no way to discover or reclaim them. This closes the original orphan-accumulation motivation that Phase 1 (`add-failed-download-cleanup-affordance`) deliberately deferred.

## What Changes

- **New Settings → Downloads dialog "Review leftover files".** A count-bearing button (hidden when zero) opens a focused dialog listing every past failed/cancelled/interrupted download whose partial file is **still on disk**, with each row's on-disk size and failure reason.
- **New read command `downloads:list-leftover`** (fs-sync). Filters the durable `downloads` table to KEEP-eligible terminal rows and **stats each `target_path` service-side** to confirm the partial still exists (rows whose file is gone are excluded — the renderer has no filesystem access). Bridged to the renderer through the full four-layer desktop surface.
- **Per-row + bulk deletion**, reusing the existing `downloads:delete-partial` primitive **unchanged**. Bulk "Delete all" (behind a confirmation) client-loops the primitive and reports a *deleted vs. failed* aggregate — one permission error never renders as "all cleared".
- **BREAKING (contract): `downloads:clear-history` now also deletes files.** The manual Clear… path unlinks the KEEP-eligible partial for every row in its delete set (completed rows' saved files are never touched). Previously it was pure-SQL and could not touch disk.
- **BREAKING (contract): the headless auto-prune now skips on-disk partials.** The config-gated 24h prune no longer deletes a KEEP-eligible row while its partial is still on disk (keeping it discoverable), and — deliberately — never unlinks files itself. This avoids a universal, silent, first-launch mass deletion, since auto-prune defaults ON for essentially all users and its first tick fires on service start.
- **Copy clarified:** the Clear-history dialog states saved files are kept and only incomplete leftovers are removed; the "Auto-delete old history" toggle clarifies it removes records (not files), with leftover files handled under "Review leftover files".

## Capabilities

### New Capabilities
<!-- None — both affected capabilities already exist. -->

### Modified Capabilities
- `fs-sync-service`: **ADDED** `downloads:list-leftover` RPC (KEEP-eligible terminal rows with an on-disk partial, service-side stat, no pagination). **MODIFIED** `downloads:clear-history` to unlink the KEEP-eligible partial for rows it deletes (completed files untouched; best-effort). **MODIFIED** the retention auto-prune to skip pruning KEEP-eligible rows whose partial is still on disk and to never unlink files.
- `file-explorer`: **ADDED** the Settings → Downloads "Review leftover files" button + dialog (list, per-row delete, bulk delete-all with confirmation, deleted-vs-failed aggregate). **MODIFIED** the Clear-download-history dialog and Auto-delete toggle copy to reflect that saved files are kept while incomplete leftovers are cleaned via the user-initiated paths.

## Impact

- **New RPC surface:** `downloads:list-leftover` across `@ft5/ipc-contracts` (wire command + `COMMAND_NAMES`/`CommandMap`), `sync-service-desktop` (channel + request/response), `apps/desktop` main IPC handler, preload binding + `window-api` types, and the renderer sync api — mirroring how `downloads:delete-partial` was bridged in Phase 1.
- **fs-sync service:** new `downloads-list-leftover` handler (needs `db` + an injected fs `stat` port); `downloads/clear-history.ts` and `downloads/prune.ts` gain a filesystem port and stat-aware logic (both were previously documented "structurally cannot touch on-disk files").
- **Renderer:** new `LeftoverFilesDialog` + a button in `settings-dialog.tsx`; copy edits to `clear-history-dialog.tsx` and the auto-delete toggle.
- **Reuse:** `downloads:delete-partial` and its complete desktop bridge already exist from Phase 1 and are reused **unchanged** — not re-implemented.
- **Behavioral shift:** enabling auto-prune no longer deletes any files in the background; every file deletion is human-initiated. A KEEP-eligible row with an on-disk partial now outlives its retention window until the user cleans it.
