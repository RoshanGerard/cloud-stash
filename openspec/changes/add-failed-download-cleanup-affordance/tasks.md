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

- [ ] 5.1 RED: toaster tests — `download-failed { partialKept: true }` renders a "Delete partial" action beside "Retry"; `partialKept` absent/false renders only "Retry"; clicking "Delete partial" invokes the binding once with the correct `downloadJobId`; a `{ deleted: true }` response dismisses the toast; an error response keeps the toast and surfaces the reason inline; no Cancel action is added.
- [ ] 5.2 GREEN: thread `partialKept` from the `download-failed` event into the toaster's `ToastEntry` and render the conditional two-action failure toast (moving off the single-slot `toast.error` to the fresh-id `toast.custom` pattern the success toast uses via `buildSuccessRender`, per the visual-refinement decisions in `design.md` `## Visual direction`).
- [ ] 5.3 Wire the "Delete partial" onClick to the preload binding; dismiss on success; render inline error on failure.

## 6. Verification

- [ ] 6.1 Full test suite + typecheck + lint green (run with node ABI: `pnpm abi:node` first).
- [ ] 6.2 `openspec validate add-failed-download-cleanup-affordance --strict` green; per-capability spec validates after sync.
- [ ] 6.3 Exercise end-to-end against a running build: fail a download leaving a kept partial, click "Delete partial", confirm the file is unlinked and the toast dismisses; confirm a delete-disposition failure shows no button. If a running-system smoke is not feasible this session, record it as a deferred smoke in `PENDING_TC.MD`.
