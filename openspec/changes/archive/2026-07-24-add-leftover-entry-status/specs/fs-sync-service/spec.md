## MODIFIED Requirements

### Requirement: `downloads:list-leftover` RPC returns KEEP-eligible rows with an on-disk partial

The service SHALL accept a command `downloads:list-leftover` on its IPC channel with an empty request (`{}`) and respond `{ ok: true, value: { entries: LeftoverEntry[] } }`. An entry SHALL be emitted for every `downloads` row whose `status` is a KEEP-eligible terminal status (`failed`, `cancelled`, or `interrupted`) AND whose recorded `target_path` the service confirms still exists on disk. Rows whose `status` is `in-flight` or `completed`, and KEEP-eligible rows whose `target_path` no longer exists, SHALL be excluded.

The handler SHALL be dispatched with access to the durable `downloads` table and a filesystem `stat` port, and SHALL NOT resolve an engine client. It SHALL `stat` each candidate `target_path` service-side — the renderer has no filesystem access, so on-disk existence and current size SHALL be determined by the service. A candidate whose `stat` rejects (ENOENT or any other error) SHALL be treated as "not a live leftover" and skipped; the handler SHALL be read-only and SHALL NOT throw.

Each `LeftoverEntry` SHALL carry `{ downloadJobId, datasourceId, sourcePath, targetPath, sizeOnDisk, status, failureTag, failureMessage, endedAt }`, where `sizeOnDisk` is the byte size reported by the `stat` (the bytes actually on disk now), and `failureTag` / `failureMessage` / `endedAt` are the row's stored values (nullable). Entries SHALL be ordered by `ended_at` descending (most recently ended first). The response SHALL NOT be paginated — the result is the retention-bounded failure subset further narrowed to files still present.

`status` SHALL be the row's own terminal disposition, carried as a required, non-nullable value drawn from the KEEP-eligible vocabulary `failed | cancelled | interrupted`. This vocabulary SHALL be declared in `@cloudstash/ipc-contracts/sync-service` as `LeftoverStatus`, derived from the existing `DownloadTerminalStatus` by excluding `completed`, so that the two vocabularies cannot drift and no value representable on this wire is unreachable in practice. Because the RPC already excludes `completed` and `in-flight` rows, `status` SHALL never take either value. The service SHALL project the disposition as a machine value and SHALL NOT compose user-facing display text for it.

#### Scenario: Lists KEEP-eligible rows whose partial is still on disk

- **WHEN** a client sends `downloads:list-leftover` and the table holds a `failed` row and a `cancelled` row whose `target_path`s both exist on disk
- **THEN** the response is `{ ok: true, value: { entries: [...] } }` containing one entry per row, each carrying `downloadJobId`, `targetPath`, and a `sizeOnDisk` equal to the file's current byte size, ordered by `ended_at` descending

#### Scenario: Each entry carries its own terminal disposition

- **WHEN** a client sends `downloads:list-leftover` and the table holds one `failed`, one `cancelled`, and one `interrupted` row whose `target_path`s all exist on disk
- **THEN** each returned entry carries a `status` equal to that row's own stored terminal status — `"failed"`, `"cancelled"`, and `"interrupted"` respectively — so the three are distinguishable by the client

#### Scenario: Disposition is present even when no failure detail was recorded

- **WHEN** a client sends `downloads:list-leftover` and the table holds a `cancelled` row whose `failure_tag` and `failure_message` are both `NULL` and whose `target_path` exists on disk
- **THEN** the returned entry still carries `status: "cancelled"`; `status` is required and is never omitted or null, regardless of whether any failure detail was recorded

#### Scenario: Excludes rows whose partial is already gone

- **WHEN** a client sends `downloads:list-leftover` and the table holds a `failed` row whose `target_path` no longer exists on disk (the `stat` rejects with `ENOENT`)
- **THEN** that row is omitted from `entries`; no error is surfaced for it

#### Scenario: Excludes completed and in-flight rows

- **WHEN** a client sends `downloads:list-leftover` and the table holds a `completed` row and an `in-flight` row whose `target_path`s exist on disk
- **THEN** neither row appears in `entries` (only `failed` / `cancelled` / `interrupted` rows with an on-disk partial are leftovers)

#### Scenario: Empty result when no leftovers remain

- **WHEN** a client sends `downloads:list-leftover` and no KEEP-eligible row has an on-disk partial
- **THEN** the response is `{ ok: true, value: { entries: [] } }`
