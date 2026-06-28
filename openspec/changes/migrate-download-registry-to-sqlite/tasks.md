# Tasks — migrate-download-registry-to-sqlite

All production code is TDD: write the failing test, watch it fail, then the
minimum code to pass. Use `vi.useFakeTimers` (or an injected clock) for the
throttle and sweep time boundaries.

Retention (configurable auto-prune), manual history clear, and any UI are
OUT OF SCOPE — deferred to the `add-download-history-ui` stub.

## 1. Schema & migration

- [x] 1.1 Add the `downloads` Drizzle table to `services/fs-sync/src/db/schema.ts` (columns + `status` enum + the two indexes per design.md Decision 6). Update `db/schema.test-d.ts` type expectations if present.
- [x] 1.2 Add forward-only migration `services/fs-sync/drizzle/0002_downloads.sql` creating the `downloads` table + `downloads_status_idx` + `downloads_started_at_idx`, all `IF NOT EXISTS`.
- [x] 1.3 Bump `CURRENT_SCHEMA_VERSION` 1 → 2 in `services/fs-sync/src/db/migrations.ts`.
- [x] 1.4 Grep for any assertion of `schema_version === 1` / `schemaVersion === 1` / "all four core tables" across `services/fs-sync` (notably `db/migrations.test.ts`, `db/integrity.test.ts`); update the fresh-init expectations to `schemaVersion = 2` and the five-table set.
- [x] 1.5 Test (TDD): fresh DB has the `downloads` table + indexes and `service_meta.schemaVersion = 2`; an existing v1 DB (no `downloads` table, `0002` not in `schema_migrations`) gains the table forward-only on next `applyMigrations`, recording `0002_downloads.sql`, leaving other tables' rows intact.

## 2. Registry write-through (memory-authoritative + SQLite mirror)

- [x] 2.1 Test (TDD): `createDownloadRegistry(db).set(entry)` inserts an `in-flight` row (`bytes_downloaded=0`, non-null `started_at`, null `ended_at`) AND keeps the existing in-memory `get`/`snapshot`/`findByKey`/`size` behavior unchanged.
- [x] 2.2 Change `createDownloadRegistry()` → `createDownloadRegistry(db)`; implement the `set` INSERT alongside the existing `Map.set` + reverse-index. Keep the registry synchronous.
- [x] 2.3 Test (TDD): `update` throttle — repeated sub-10 MB / sub-30 s updates rewrite the in-memory slot every time but write the `downloads` row only at the 10 MB OR 30 s boundary (assert both boundaries, including the "exactly at threshold" cases).
- [x] 2.4 Implement the per-job throttle tracker (`lastFlushedBytes`, `lastFlushedAtMs`) and the gated `UPDATE` in `update`.
- [x] 2.5 Test (TDD): `finalize(id, outcome)` — for each outcome (`completed` / `cancelled` / `failed` + tag/message), the in-memory entry and reverse-index key are removed AND the `downloads` row is updated to the terminal status with force-flushed final `bytes_downloaded`, non-null `ended_at`, and (for `failed`) `failure_tag` / `failure_message`. Assert force-flush ignores the throttle and the tracker entry is cleared.
- [x] 2.6 Replace the registry's `delete(id)` with `finalize(id, outcome)` (force-flush + terminal `UPDATE` + `Map.delete` + reverse-index cleanup + tracker cleanup).

## 3. `files:download` handler call-site migration

- [x] 3.1 Test (TDD): the handler calls `registry.finalize` with the correct outcome at each terminal path — success → `completed` (`bytesDownloaded = bytesWritten`), abort/cancel → `cancelled`, error → `failed` + normalized tag/message — via the existing handler integration test harness.
- [x] 3.2 Switch the terminal `registry.delete(downloadJobId)` call-sites in `services/fs-sync/src/commands/files-download.ts` (~`:1602` finally/error path, `:1620` success path) to `registry.finalize(downloadJobId, outcome)`; map the normalized error to `failureTag` / `failureMessage` on the failure path.
- [x] 3.3 Confirm `sync:cancel-download` still reads the live entry via `registry.get(...)` and aborts via `entry.abortController` (no change — memory path intact).

## 4. Startup interrupted-sweep

- [x] 4.1 Test (TDD): `sweepInterruptedDownloads(db)` transitions `in-flight` rows → `interrupted` (sets `ended_at`/`updated_at`), leaves terminal rows untouched, and does not touch files on disk.
- [x] 4.2 Implement `sweepInterruptedDownloads(db)` in `services/fs-sync/src/downloads/` (model on `recoverRunningJobs`).

## 5. Bootstrap wiring

- [ ] 5.1 Pass `db` into `createDownloadRegistry(db)` in `services/fs-sync/src/main/bootstrap.ts`.
- [ ] 5.2 Call `sweepInterruptedDownloads(db)` AFTER the PID guard is acquired (bootstrap stage 4+); add/extend a test asserting the sweep runs only post-PID-guard.

## 6. Verification & integration

- [ ] 6.1 Confirm the existing `files-download` and `downloads-list-active` tests pass UNCHANGED (wire contract intact; `list-active` still reads the in-memory snapshot).
- [ ] 6.2 Composite test: a download runs to completion → its `downloads` row is persisted `completed`; a simulated restart leaves an `in-flight` row that the startup sweep marks `interrupted`; terminal rows are untouched by the sweep.
- [ ] 6.3 Full verification: `services/fs-sync` test suite + workspace typecheck + lint all green.
- [ ] 6.4 `openspec validate migrate-download-registry-to-sqlite --strict` green; reactive audit gate N/A (forward change) — confirm no unintended wire/contract drift beyond the spec delta.
