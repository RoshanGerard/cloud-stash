## ADDED Requirements

### Requirement: `downloads:list-leftover` RPC returns KEEP-eligible rows with an on-disk partial

The service SHALL accept a command `downloads:list-leftover` on its IPC channel with an empty request (`{}`) and respond `{ ok: true, value: { entries: LeftoverEntry[] } }`. An entry SHALL be emitted for every `downloads` row whose `status` is a KEEP-eligible terminal status (`failed`, `cancelled`, or `interrupted`) AND whose recorded `target_path` the service confirms still exists on disk. Rows whose `status` is `in-flight` or `completed`, and KEEP-eligible rows whose `target_path` no longer exists, SHALL be excluded.

The handler SHALL be dispatched with access to the durable `downloads` table and a filesystem `stat` port, and SHALL NOT resolve an engine client. It SHALL `stat` each candidate `target_path` service-side — the renderer has no filesystem access, so on-disk existence and current size SHALL be determined by the service. A candidate whose `stat` rejects (ENOENT or any other error) SHALL be treated as "not a live leftover" and skipped; the handler SHALL be read-only and SHALL NOT throw.

Each `LeftoverEntry` SHALL carry `{ downloadJobId, datasourceId, sourcePath, targetPath, sizeOnDisk, failureTag, failureMessage, endedAt }`, where `sizeOnDisk` is the byte size reported by the `stat` (the bytes actually on disk now), and `failureTag` / `failureMessage` / `endedAt` are the row's stored values (nullable). Entries SHALL be ordered by `ended_at` descending (most recently ended first). The response SHALL NOT be paginated — the result is the retention-bounded failure subset further narrowed to files still present.

#### Scenario: Lists KEEP-eligible rows whose partial is still on disk

- **WHEN** a client sends `downloads:list-leftover` and the table holds a `failed` row and a `cancelled` row whose `target_path`s both exist on disk
- **THEN** the response is `{ ok: true, value: { entries: [...] } }` containing one entry per row, each carrying `downloadJobId`, `targetPath`, and a `sizeOnDisk` equal to the file's current byte size, ordered by `ended_at` descending

#### Scenario: Excludes rows whose partial is already gone

- **WHEN** a client sends `downloads:list-leftover` and the table holds a `failed` row whose `target_path` no longer exists on disk (the `stat` rejects with `ENOENT`)
- **THEN** that row is omitted from `entries`; no error is surfaced for it

#### Scenario: Excludes completed and in-flight rows

- **WHEN** a client sends `downloads:list-leftover` and the table holds a `completed` row and an `in-flight` row whose `target_path`s exist on disk
- **THEN** neither row appears in `entries` (only `failed` / `cancelled` / `interrupted` rows with an on-disk partial are leftovers)

#### Scenario: Empty result when no leftovers remain

- **WHEN** a client sends `downloads:list-leftover` and no KEEP-eligible row has an on-disk partial
- **THEN** the response is `{ ok: true, value: { entries: [] } }`

## MODIFIED Requirements

### Requirement: IPC command surface

The service SHALL accept and correctly respond to the following commands on its IPC channel: `sync:enqueue-mirror`, `sync:list-jobs`, `sync:get-job`, `sync:cancel-job`, `sync:cancel-upload`, `sync:cancel-download`, `sync:subscribe-events`, `sync:unsubscribe-events`, `sync:set-retry-policy`, `sync:get-retry-policy`, `sync:authenticate-start`, `sync:authenticate-complete`, `sync:authenticate-cancel`, `sync:get-config`, `sync:set-config`, `sync:delete-credentials`, `sync:get-status`, `files:list`, `files:stat`, `files:search`, `files:remove`, `files:rename`, `files:download`, `files:upload`, `downloads:list-active`, `downloads:clear-history`, `downloads:delete-partial`, `downloads:list-leftover`, `uploads:list-active`. The previous `sync:enqueue-upload` command SHALL NOT be present (replaced by `files:upload` per this change). Request and response types for every command SHALL be declared in `@ft5/ipc-contracts/sync-service` as discriminated unions, keyed by the `command` field. Any command frame whose `command` is not in this enumerated set SHALL receive a response with `ok: false, error.tag === 'unknown-command'`.

The new `files:upload` command SHALL accept `{ datasourceId, sourcePath, targetPath, conflictPolicy }` and resolve the engine client for that `datasourceId` via the service's existing `ClientFactory`. The response envelope is the standard discriminated union with `value: { uploadJobId: string }` on success. Error tags include the existing taxonomy plus `"conflict"` (carrying `existingUploadJobId` and `targetPath` for the concurrent-target case).

#### Scenario: Service rejects unknown-command for sync:enqueue-upload

- **WHEN** a frame `{ command: "sync:enqueue-upload", … }` arrives over the IPC channel after this change is applied
- **THEN** the response is `{ ok: false, error: { tag: "unknown-command", message } }`

#### Scenario: files:upload command is registered

- **WHEN** a frame `{ command: "files:upload", params: { datasourceId, sourcePath, targetPath, conflictPolicy: "fail" } }` arrives
- **THEN** the dispatcher routes it to the new `files-upload.ts` handler; the response shape is `{ ok: true, value: { uploadJobId } }` on success

#### Scenario: uploads:list-active and sync:cancel-upload commands are registered

- **WHEN** the dispatcher's command-name set is enumerated
- **THEN** the set includes `"uploads:list-active"`, `"sync:cancel-upload"`, and `"files:upload"`; it does NOT include `"sync:enqueue-upload"`

#### Scenario: downloads:clear-history command is registered

- **WHEN** a frame `{ command: "downloads:clear-history", params: {} }` arrives over the IPC channel
- **THEN** the dispatcher routes it to the clear-history handler and the response shape is `{ ok: true, value: { deleted: <number> } }`; the dispatcher's command-name set includes `"downloads:clear-history"`

#### Scenario: downloads:delete-partial command is registered

- **WHEN** a frame `{ command: "downloads:delete-partial", params: { downloadJobId } }` arrives over the IPC channel
- **THEN** the dispatcher routes it to the delete-partial handler and the response shape is `{ ok: true, value: { deleted: <boolean> } }`; the dispatcher's command-name set includes `"downloads:delete-partial"`

#### Scenario: downloads:list-leftover command is registered

- **WHEN** a frame `{ command: "downloads:list-leftover", params: {} }` arrives over the IPC channel
- **THEN** the dispatcher routes it to the list-leftover handler and the response shape is `{ ok: true, value: { entries: <array> } }`; the dispatcher's command-name set includes `"downloads:list-leftover"`

### Requirement: Config-gated download-history auto-prune

The service SHALL run `pruneDownloadHistory(db, { maxAgeMs })`, which deletes aged terminal `downloads` rows (`status` not `in-flight` AND `ended_at` older than `now - maxAgeMs`), with one carve-out: it SHALL skip deleting any KEEP-eligible terminal row (`failed`, `cancelled`, or `interrupted`) whose recorded `target_path` still exists on disk. Such a row is retained past its retention window so it stays discoverable via `downloads:list-leftover`; it is pruned on a later cycle once its file is gone. Completed aged rows, and KEEP-eligible aged rows whose `target_path` no longer exists, SHALL be deleted as before. Determining on-disk existence requires a filesystem `stat` port; a `stat` that rejects (ENOENT or otherwise) SHALL be treated as "file gone" so the row is eligible for deletion. Pruning SHALL never delete `in-flight` rows and SHALL never delete on-disk files — the headless path removes records only, never unlinks.

A scheduler SHALL resolve the current retention settings (see "Service config carries optional download-history retention settings") on service start — after the startup interrupted-sweep introduced by `migrate-download-registry-to-sqlite` — and every 24 hours thereafter: when `autoPrune` is enabled it SHALL prune with `maxAgeMs = retentionDays * 86_400_000`; when disabled it SHALL skip pruning. The 24-hour timer SHALL be cleared on service shutdown. A per-row `stat` error SHALL degrade to treating that row's file as gone and SHALL NOT abort the prune cycle. (The `downloads` table and its `status` / `ended_at` columns are owned by `migrate-download-registry-to-sqlite`.)

#### Scenario: Auto-prune deletes aged completed rows when enabled

- **WHEN** the scheduler runs with `{ autoPrune: true, retentionDays: 90 }` and the `downloads` table holds a `completed` row whose `ended_at` is 91 days old and a `failed` row whose `ended_at` is 10 days old
- **THEN** the 91-day-old completed row is deleted and the 10-day-old row remains; no on-disk file is touched

#### Scenario: Aged leftover row with an on-disk partial is retained

- **WHEN** the scheduler runs with `{ autoPrune: true, retentionDays: 90 }` and the table holds a `failed` row whose `ended_at` is 200 days old and whose `target_path` still exists on disk
- **THEN** the row is NOT deleted (it is retained so it remains discoverable via `downloads:list-leftover`); no on-disk file is touched

#### Scenario: Aged leftover row whose partial is already gone is pruned

- **WHEN** the scheduler runs with `{ autoPrune: true, retentionDays: 90 }` and the table holds a `cancelled` row whose `ended_at` is 200 days old and whose `target_path` no longer exists on disk (the `stat` rejects)
- **THEN** the row is deleted (there is no on-disk partial to keep discoverable); no on-disk file is touched

#### Scenario: Auto-prune is skipped when disabled

- **WHEN** the scheduler runs with `{ autoPrune: false, retentionDays: 90 }` and the table holds a `completed` row whose `ended_at` is 200 days old
- **THEN** no rows are deleted

#### Scenario: In-flight rows are never pruned

- **WHEN** the scheduler runs (auto-prune enabled) and the table holds an `in-flight` row whose `started_at` is older than the retention window
- **THEN** the `in-flight` row is not deleted

#### Scenario: Prune timer is cleared on shutdown

- **WHEN** the service shuts down
- **THEN** the 24-hour prune interval timer is cleared and no further prune runs after shutdown

### Requirement: `downloads:clear-history` deletes matching terminal download rows

The service SHALL accept `downloads:clear-history` with request `{ filter?: { status?: DownloadTerminalStatus[]; olderThanMs?: number } }` and respond with `{ ok: true, value: { deleted: number } }`, where `deleted` is the number of rows removed. With no `filter`, the handler SHALL delete all terminal rows (`status != 'in-flight'`). A `status` filter SHALL restrict the delete to those terminal statuses; an `olderThanMs` filter SHALL restrict to rows whose `ended_at` is older than `now - olderThanMs`; both filters combine (AND). The handler SHALL never delete `in-flight` rows.

Before deleting the matched rows, the handler SHALL unlink the recorded `target_path` of every KEEP-eligible terminal row (`failed`, `cancelled`, or `interrupted`) in the computed delete set. Completed rows' saved files SHALL NOT be touched — the unlink is filtered to the KEEP-eligible subset even though the row DELETE removes all matched terminal rows. The unlink SHALL be best-effort: ENOENT / EACCES / EPERM (or any other unlink error) SHALL be tolerated and SHALL NOT block the row deletion nor alter the returned `deleted` count (which counts rows removed). This requires a filesystem port at the handler. The handler SHALL emit no event/broadcast (the renderer toaster renders only in-flight downloads, which this never touches).

#### Scenario: Clear with no filter deletes all terminal rows

- **WHEN** a client sends `downloads:clear-history { }` and the table holds 3 terminal rows and 1 `in-flight` row
- **THEN** the 3 terminal rows are deleted, the `in-flight` row remains, the response is `{ ok: true, value: { deleted: 3 } }`; any KEEP-eligible partials among the deleted rows are unlinked while completed rows' saved files are left intact

#### Scenario: Clear unlinks KEEP-eligible partials but keeps completed files

- **WHEN** a client sends `downloads:clear-history { }` and the table holds a `failed` row whose `target_path` exists on disk and a `completed` row whose `target_path` exists on disk
- **THEN** both rows are deleted (`deleted: 2`); the `failed` row's partial file is unlinked; the `completed` row's saved file is left intact on disk

#### Scenario: Clear unlink is best-effort and non-blocking

- **WHEN** a client sends `downloads:clear-history { }`, the delete set includes a `failed` row, and the unlink of its `target_path` rejects with `EACCES`
- **THEN** the row is still deleted and counted in `deleted`; the handler does not throw and returns `{ ok: true, value: { deleted: <count> } }`

#### Scenario: Clear with a status filter deletes only those statuses

- **WHEN** a client sends `downloads:clear-history { filter: { status: ["failed", "interrupted"] } }` and the table holds 2 `failed`, 1 `interrupted`, and 2 `completed` rows
- **THEN** only the 3 `failed`/`interrupted` rows are deleted; the 2 `completed` rows remain; the response is `{ ok: true, value: { deleted: 3 } }`; the deleted rows' on-disk partials are unlinked (best-effort)

#### Scenario: Clear with an age filter deletes only old terminal rows

- **WHEN** a client sends `downloads:clear-history { filter: { olderThanMs: <30 days> } }` and the table holds a `completed` row 40 days old and a `cancelled` row 5 days old
- **THEN** only the 40-day-old completed row is deleted; the response is `{ ok: true, value: { deleted: 1 } }`; no on-disk file is touched (the deleted row is `completed`)

#### Scenario: Clear never deletes in-flight rows

- **WHEN** a client sends `downloads:clear-history { filter: { olderThanMs: 0 } }` and the table holds an `in-flight` row of any age
- **THEN** the `in-flight` row is not deleted and its on-disk file is not touched
