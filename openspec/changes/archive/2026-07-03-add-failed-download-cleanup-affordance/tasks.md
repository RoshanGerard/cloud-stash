# Tasks: add-failed-download-cleanup-affordance (Phase 1)

TDD throughout: write the failing test, watch it fail, then the minimum
code to pass. Contract → service → emit → bridge → renderer → verify.

## 1. Wire contract (`packages/ipc-contracts`)

- [x] 1.1 Add `partialKept?: boolean` (optional) to `DownloadFailedPayload` in `packages/ipc-contracts/src/sync-service/events.ts`; extend the payload type test to cover the optional field.
- [x] 1.2 Add the `downloads:delete-partial` command to the sync-service command map: request `{ downloadJobId: string }`, success `value: { deleted: boolean }`, and an error envelope carrying a `message`. Add it to `COMMAND_NAMES` and any channel constant. Add a type test for the new request/response pair.
- [x] 1.3 Rebuild the package (`pnpm --filter @ft5/ipc-contracts build`) so downstream value/type imports resolve.

## 2. Service — `downloads:delete-partial` handler (TDD)

- [x] 2.1 RED: unit tests for the handler covering all guard/mapping branches: (a) recorded + terminal row with existing file → unlinks + `{ deleted: true }`; (b) `unlink` ENOENT → `{ deleted: true }`; (c) unknown `downloadJobId` (no row) → `{ deleted: false }` no-op; (d) row `status === 'in-flight'` → refuse, unlink nothing, error envelope; (e) `unlink` EACCES/EPERM → error envelope.
- [x] 2.2 GREEN: implement the handler in `services/fs-sync/src/commands/downloads-delete-partial.ts` (co-located with the other command handlers; a single SELECT + unlink didn't warrant a separate `downloads/` SQL-core module) — read `target_path` + `status` from the `downloads` table by `downloadJobId`, apply the terminal+recorded guard, `unlink` via the injectable fs boundary, map ENOENT→success and EACCES/EPERM→error.
- [x] 2.3 Register the command in the dispatcher (`services/fs-sync/src/commands/handlers.ts`) wired like `downloads:clear-history` — needs `deps.db` + an fs `unlink`, NOT `resolveClient`/engine. Add the dispatcher command-name-set test asserting `"downloads:delete-partial"` is present.

## 3. Service — `partialKept` on `download-failed` emit (TDD)

- [x] 3.1 RED: tests pinning `partialKept` per disposition class at the `download-failed` emit sites: KEEP + bytes (byte-count-mismatch, 512 B) → `true`; DELETE causes (range-mismatch / integrity-failed) → `false`; KEEP but pre-stream 0-byte (auth-revoked) → `false`.
- [x] 3.2 GREEN: compute and set `partialKept` at each of the 7 `download-failed` emits in `services/fs-sync/src/commands/files-download.ts` from the disposition already known there: `!isDeleteDisposition && bytesWritten > 0`. Uses `bytesWritten` (the target's actual `statSize` — the authoritative "bytes on disk" signal) rather than the registry-tracked count, which can lag disk. No disposition-policy change.

## 4. Desktop main + preload bridge

- [x] 4.1 Add the `ipcMain.handle` bridge for the delete-partial command under `apps/desktop/src/main/` (`ipc/sync/delete-partial.ts` → `SyncClient.deletePartial`), registered in the IPC index; add `SYNC_CHANNELS.deletePartial` + `SyncDeletePartial{Request,Response}` desktop-facing types + `SyncClient.deletePartial`. Proxy test mirrors `clear-download-history.test.ts`.
- [x] 4.2 Add the preload binding `window.api.sync.deletePartial` (mirroring `clearDownloadHistory`) via `contextBridge`.
- [x] 4.3 Add the `window.api` type declaration in BOTH `apps/desktop/src/preload/window-api.d.ts` and `apps/desktop/src/renderer/src/types/window-api.d.ts`.
- [x] 4.4 Four-layer wiring assertions: `channels.test-d.ts` exact-set (+`deletePartial`), `sync-surface.test.ts` exact-member-set (16→17) + round-trip test, `window-api.types.test-d.ts` return-type test. (Renderer call site lands in Task 5.)

## 5. Renderer — failure-toast Delete-partial action (TDD)

- [x] 5.1 RED: toaster tests (d3–d7) — `download-failed { partialKept: true }` renders a fresh-id custom card with Retry + Delete partial (no Cancel); `partialKept: false` stays on `toast.error`; clicking Delete partial invokes `syncApi.deletePartial({ downloadJobId })` once and dismisses on success; a rejection keeps the card and re-renders an inline error with Retry intact.
- [x] 5.2 GREEN: add `partialKept?` to the renderer `DownloadEvent`; branch the `download-failed` handler — kept → fresh-id `toast.custom` via new `buildFailureWithDeleteRender` (red literal-palette card per `design.md ## Visual direction`); non-kept → existing `toast.error` (unchanged).
- [x] 5.3 Add `deletePartial` to `SyncActionsApi` + the production `resolveSyncApi` resolver (`window.api.sync.deletePartial`, lazy like `cancelDownload`); wire onClick → dismiss on success, inline error on failure. Production toaster is `createDownloadJobToaster()` (no deps) so the default resolver handles it. All 47 toaster tests green.

## 6. Verification

- [x] 6.1 Full test suite + typecheck + lint green (node ABI): full repo 326 files / 3108 passed / 0 failed / no type errors; `tsc -b` clean; `eslint .` clean.
- [x] 6.2 `openspec validate add-failed-download-cleanup-affordance --strict` green; per-capability spec validates after sync (archive step).
- [x] 6.3 Running-system smoke DEFERRED to `PENDING_TC.MD` — a real-provider download failure leaving a KEPT partial is not reproducible in this environment (needs a live provider + mid-stream fault). The full delete-partial + partialKept path is unit/integration covered end-to-end (backend handler, emit-site disposition, four-layer bridge, renderer custom card + click dispatch + inline error).
