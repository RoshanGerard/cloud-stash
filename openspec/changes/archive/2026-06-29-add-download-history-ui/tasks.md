# Tasks — add-download-history-ui

All production code is TDD: failing test → watch it fail → minimum code to
pass. Use `vi.useFakeTimers` / an injected clock for window-boundary and
24h-timer tests.

**Visible UI** (Settings controls + confirm dialog) — implement per
`design.md ## Visual direction`, which the mandatory visual-refinement step
populates BEFORE `/opsx:apply`.

## 0. Dependency gate (do not start impl until satisfied)

- [x] 0.1 Confirm `migrate-download-registry-to-sqlite` is applied/merged (or this branch is stacked on migrate's). The `downloads` table + five-status model MUST exist; TDD here references that schema. See `design.md ## Dependencies`.
- [x] 0.2 Reconcile the shared `services/fs-sync/src/main/bootstrap.ts` edit: the config-gated prune runs AFTER migrate's `sweepInterruptedDownloads` (which runs after the PID guard).

## 1. Contracts (`@ft5/ipc-contracts`)

- [x] 1.1 Test (TDD, type-level): `ServiceConfig` accepts optional `downloadHistory?: { autoPrune: boolean; retentionDays: 30 | 90 | 180 | 365 }`; omitting it stays valid.
- [x] 1.2 Extend `ServiceConfig` in `packages/ipc-contracts/src/sync-service/commands.ts` with the optional `downloadHistory` field.
- [x] 1.3 Test (TDD, type-level): `DownloadTerminalStatus` is exactly `'completed' | 'failed' | 'cancelled' | 'interrupted'` (excludes `in-flight`); `downloads:clear-history` request `{ filter?: { status?: DownloadTerminalStatus[]; olderThanMs?: number } }` + response `{ ok: true, value: { deleted: number } }` type-check.
- [x] 1.4 Add `DownloadTerminalStatus` + the `downloads:clear-history` command discriminated-union member to `commands.ts`; rebuild `@ft5/ipc-contracts` so value/type imports resolve downstream.

## 2. Service — config defensive read + validation

- [x] 2.1 Test (TDD): a retention-settings resolver returns `{ autoPrune: true, retentionDays: 90 }` for absent OR malformed `downloadHistory` (wrong shape / off-set `retentionDays` / non-boolean `autoPrune`); returns the stored value when valid.
- [x] 2.2 Implement the resolver (read site for the default; do NOT rely on the `as ServiceConfig` cast).
- [x] 2.3 Test (TDD): `sync:set-config` rejects `downloadHistory` with `retentionDays ∉ {30,90,180,365}` or non-boolean `autoPrune` (`io-error`, file unmodified); accepts a valid one and round-trips.
- [x] 2.4 Add the `downloadHistory` validation to the set-config path (handler or `ServiceConfigStore`).

## 3. Service — config-gated auto-prune

- [x] 3.1 Test (TDD): `pruneDownloadHistory(db, { maxAgeMs })` deletes `status != 'in-flight' AND ended_at < now - maxAgeMs`, never in-flight, never files; asserts the age boundary.
- [x] 3.2 Implement `pruneDownloadHistory` in `services/fs-sync/src/downloads/`.
- [x] 3.3 Test (TDD): the scheduler prunes on start + every 24h when `autoPrune` on (using `retentionDays`), skips when off, and clears its timer on shutdown (fake timers).
- [x] 3.4 Implement the scheduler + wire it into `bootstrap.ts` AFTER `sweepInterruptedDownloads`; clear the interval on shutdown.

## 4. Service — `downloads:clear-history` handler

- [x] 4.1 Test (TDD): handler deletes all terminal rows on no filter; restricts by `status`; restricts by `olderThanMs`; combines both (AND); never deletes in-flight; never touches files; returns `{ deleted: N }`.
- [x] 4.2 Implement the `downloads:clear-history` handler + register it in the dispatcher command set.

## 5. Desktop bridge (first renderer consumer of config get/set)

- [x] 5.1 Test (TDD): main-process IPC handlers forward `sync:get-config` / `sync:set-config` / `downloads:clear-history` to the service and return the response.
- [x] 5.2 Implement the main-process IPC handlers (mirror the `downloads:list-active` bridge).
- [x] 5.3 Expose `getConfig` / `setConfig` / `clearDownloadHistory` on the preload `window.api`; add the preload-bundle/contract test coverage they require.

## 6. Renderer — read-modify-write config helper (CRITICAL)

- [x] 6.1 Test (TDD): the config helper `getConfig → spread-merge downloadHistory → setConfig` preserves `schemaVersion` and existing `providers` (assert OAuth secrets survive a `downloadHistory` write); bases the merge on a fresh read.
- [x] 6.2 Implement the helper.

## 7. Renderer — Settings → Downloads controls (per `## Visual direction`)

- [x] 7.1 Test (TDD): auto-prune `Switch` reflects `downloadHistory.autoPrune` and writes via the helper; retention-window `DropdownMenuRadioGroup` offers 30/90/180/365, defaults 90, writes via the helper, and is dimmed/non-interactive when auto-prune is off.
- [x] 7.2 Test (TDD): "Clear download history" opens a destructive-confirm dialog whose copy states on-disk files are not deleted; on confirm dispatches `downloads:clear-history` with the chosen filter; reports `{ deleted }` via a toast.
- [x] 7.3 Implement the controls in `settings-dialog.tsx` per `design.md ## Visual direction` (mirror existing Switch + page-size dropdown rows). WCAG AA.

## 8. Verification

- [x] 8.1 Existing config / settings tests pass unchanged where behavior is unchanged; the get/set-config "renderer SHALL NOT call" expectation is updated to the renderer-consumer reality.
- [x] 8.2 Full verification: `services/fs-sync` + `apps/desktop` + `@ft5/ipc-contracts` suites + workspace typecheck + lint all green.
- [x] 8.3 `openspec validate add-download-history-ui --strict` green; per-capability spec validation green after sync.
