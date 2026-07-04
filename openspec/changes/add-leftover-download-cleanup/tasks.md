# Tasks — add-leftover-download-cleanup

Discipline: TDD (RED → watch fail → GREEN) on every code task; worktree at `<repo-root>/.worktrees/add-leftover-download-cleanup/`; subagent-per-task with the CLAUDE.md preamble; code review between tasks; advisor checkpoint #2 before archive. `downloads:delete-partial` and its complete desktop bridge already exist from Phase 1 and are **reused UNCHANGED** — do NOT re-implement them. Exact row layout, bulk-confirm styling, and final copy strings come from the post-propose visual-refinement pass (Group 6 lands the functional behavior against that direction).

## 1. Wire contract — `downloads:list-leftover` (@ft5/ipc-contracts)

- [x] 1.1 Add `LeftoverEntry` type (`downloadJobId, datasourceId, sourcePath, targetPath, sizeOnDisk, failureTag, failureMessage, endedAt`) and `ListLeftoverRequest = {}` / `ListLeftoverResponse` (envelope with `value: { entries: LeftoverEntry[] }`) to `sync-service/commands.ts`; add `ListLeftoverCommand`.
- [x] 1.2 Register `"downloads:list-leftover"` in `CommandMap` and `COMMAND_NAMES` (after `downloads:delete-partial`).
- [x] 1.3 Re-export the new types from `sync-service/index.ts`.
- [x] 1.4 Add `"downloads:list-leftover"` to the exhaustive `CommandName` `Expected` unions in `sync-service/commands.test-d.ts` and `sync-service/authenticate-onboarding.test-d.ts` (both pin the full set — `tsc -b` fails otherwise).
- [x] 1.5 Add `sync-service/__tests__/list-leftover.test-d.ts` — type tests for `LeftoverEntry`, request/response, and the command registration.

## 2. Desktop channel + four-layer bridge (sync-service-desktop + apps/desktop)

- [ ] 2.1 Add `SyncListLeftoverRequest`/`SyncListLeftoverResponse` (flat `{ entries }` desktop shape) to `sync-service-desktop/requests.ts`; add `SYNC_CHANNELS.listLeftover = "downloads:list-leftover"` to `channels.ts`; export from `index.ts`; update the exact-key-set assertion in `channels.test-d.ts`.
- [ ] 2.2 Add `apps/desktop/src/main/ipc/sync/list-leftover.ts` (`handleListLeftover`, proxies to `SyncClient.listLeftover`) and register `ipcMain.handle(SYNC_CHANNELS.listLeftover, …)` in `main/ipc/index.ts`.
- [ ] 2.3 Add the `listLeftover(params)` typed wrapper to `main/sync/client.ts`.
- [ ] 2.4 Add the `window.api.sync.listLeftover` binding in `preload/index.ts` and the types in `preload/window-api.d.ts` + `renderer/src/types/window-api.d.ts`.
- [ ] 2.5 Bump the preload sync-surface count test (`preload/__tests__/sync-surface.test.ts`) 17→18; add the round-trip test, the `window-api.types.test-d.ts` type test, and `main/ipc/sync/__tests__/list-leftover.test.ts` (proxy test).

## 3. Service handler — `downloads:list-leftover` (services/fs-sync)

- [x] 3.1 RED: `services/fs-sync/src/commands/downloads-list-leftover.test.ts` — KEEP-eligible + on-disk → entry with `sizeOnDisk` from stat; ENOENT/errored stat → excluded; completed/in-flight → excluded; empty result; ordered by `ended_at` desc; never throws.
- [x] 3.2 GREEN: `services/fs-sync/src/commands/downloads-list-leftover.ts` — `makeListLeftoverHandler({ db, fs? })` with an injected `stat` port (defaults to `node:fs/promises`), mirroring `downloads-delete-partial.ts`'s fs injection. SELECT KEEP-eligible rows ordered `ended_at` DESC, stat each `target_path`, project surviving rows to `LeftoverEntry`.
- [x] 3.3 Register `"downloads:list-leftover": makeListLeftoverHandler({ db: deps.db })` in `commands/handlers.ts` (unconditional db-only wiring, like clear-history/delete-partial).
- [x] 3.4 Add the dispatcher-registration test to `commands/handlers.test.ts` (handler defined; empty-DB call returns `{ entries: [] }`).

## 4. Contract change — `clearDownloadHistory` unlinks KEEP-eligible partials (services/fs-sync)

- [x] 4.1 RED: extend `commands/downloads-clear-history.test.ts` (and/or the `downloads/clear-history` unit test) — a `failed` row's partial is unlinked while a `completed` row's file is kept; both rows deleted; unlink `EACCES` is best-effort (row still deleted, no throw); `deleted` counts rows.
- [x] 4.2 GREEN: add a filesystem port to `downloads/clear-history.ts`; before the DELETE, SELECT the KEEP-eligible (`failed`/`cancelled`/`interrupted`) `target_path`s in the computed delete set, `unlink` each best-effort (tolerate ENOENT/EACCES/EPERM), then DELETE the rows. Completed files never touched.
- [x] 4.3 Thread the fs port through `makeClearDownloadHistoryHandler` and its `handlers.ts` wiring (default to `node:fs/promises`).

## 5. Contract change — `pruneDownloadHistory` skips on-disk partials (services/fs-sync)

- [ ] 5.1 RED: extend `downloads/__tests__/prune.test.ts` — aged `failed` row with on-disk partial is RETAINED; aged `cancelled` row whose file is gone is PRUNED; aged `completed` row is PRUNED; no file is ever unlinked; a per-row stat error degrades to "file gone" (row pruned) and does not abort the cycle.
- [ ] 5.2 GREEN: add a filesystem `stat` port to `downloads/prune.ts`; stat the KEEP-eligible aged rows and exclude the ones whose `target_path` still exists from the DELETE set (completed + gone-file KEEP-eligible rows still deleted). Never unlink.
- [ ] 5.3 Thread the fs port through `createPruneScheduler` (`prune-scheduler.ts` deps + `runOnce`), preserving the degrade-not-crash guard; update `prune-scheduler.test.ts`.

## 6. Renderer — Review-leftover-files button + dialog (apps/desktop renderer)

- [ ] 6.1 Add `listLeftover` to the renderer sync-api resolver used by Settings (lazy `window.api.sync.listLeftover`).
- [ ] 6.2 RED+GREEN: fetch the leftover list when the Settings dialog opens; render a "Review leftover files (N)" button that carries the count and is hidden when N = 0.
- [ ] 6.3 RED+GREEN: `LeftoverFilesDialog` — lists each entry (file name, on-disk size, failure reason per visual direction), focus-restores to the opening button. Per-row Delete → `downloads:delete-partial { downloadJobId }`, remove row on success.
- [ ] 6.4 RED+GREEN: bulk "Delete all" behind a destructive confirm; client-loops `downloads:delete-partial` over the shown `downloadJobId`s; reports a deleted-vs-failed aggregate (one `EACCES` ≠ "all cleared").
- [ ] 6.5 Copy edits per visual direction: `clear-history-dialog.tsx` → "Saved files are kept; incomplete leftover files are removed"; auto-delete toggle helper text → records-only + points to Review leftover files.
- [ ] 6.6 Tests: button count/visibility (0 hidden, N shown), dialog list render, per-row delete removes row, bulk aggregate distinguishes deleted vs failed.

## 7. Verification & pre-archive

- [ ] 7.1 Full test suite green (`pnpm abi:node` first in the main checkout), `tsc -b`, eslint, and `openspec validate add-leftover-download-cleanup --strict` all clean.
- [ ] 7.2 Confirm `downloads:delete-partial` and its bridge were reused unchanged (no re-implementation); confirm completed files are provably never unlinked by clear-history or prune (assertions present).
- [ ] 7.3 Exercise against a running system where feasible (or record a deferred running-system smoke in `PENDING_TC.MD` with a coverage map, mirroring Phase 1 §6.3).
