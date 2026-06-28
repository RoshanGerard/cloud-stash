## MODIFIED Requirements

### Requirement: SQLite database schema and migrations

The service SHALL open a SQLite database at `$HOME/ft5/sync_app/sync.db` using `better-sqlite3`, with `journal_mode = WAL` and `synchronous = NORMAL`. Schema SHALL be defined via Drizzle ORM at `services/fs-sync/src/db/schema.ts` and SHALL include at least the tables `service_meta`, `jobs`, `sync_snapshot`, `retry_policies`, `downloads`. Migrations SHALL live under `services/fs-sync/drizzle/` and run forward-only on service start. The `downloads` table SHALL be introduced by a new forward-only migration `services/fs-sync/drizzle/0002_downloads.sql`, and `CURRENT_SCHEMA_VERSION` SHALL be `2`. The service SHALL run `PRAGMA integrity_check` on startup and, if the result is not `"ok"`, SHALL log a fatal error and exit with code `4`.

#### Scenario: Fresh database is initialized on first start

- **WHEN** the service starts against an empty `FT5_SYNC_DATA_DIR`
- **THEN** `sync.db` is created, all five core tables (`service_meta`, `jobs`, `sync_snapshot`, `retry_policies`, `downloads`) exist (verifiable via `sqlite_master`), and `service_meta` has exactly one row with `schemaVersion = 2`

#### Scenario: Existing v1 database gains the downloads table on upgrade

- **WHEN** the service starts against a `sync.db` that was initialized at schema version 1 (no `downloads` table) and whose `schema_migrations` does not record `0002_downloads.sql`
- **THEN** the `0002_downloads.sql` migration runs forward-only, the `downloads` table and its indexes are created, `schema_migrations` records `0002_downloads.sql`, and pre-existing rows in the other tables are unchanged

#### Scenario: Integrity failure halts startup

- **WHEN** a test seeds `sync.db` with a deliberately-corrupted page, then invokes the service
- **THEN** the service exits with code `4` within 2 seconds, logs `"integrity-check-failed"`, and no IPC listener is opened

#### Scenario: Drizzle import is confined to the service's main tree

- **WHEN** a Vitest test grep-scans every `.ts` file under `services/fs-sync/src/` for `from "drizzle-orm"` or `from "better-sqlite3"`
- **THEN** matches exist only under `services/fs-sync/src/db/` and `services/fs-sync/src/main/`; no other subtree imports these modules

### Requirement: In-memory `DownloadRegistry` tracks active downloads

The service SHALL maintain an in-memory `DownloadRegistry` at `services/fs-sync/src/downloads/registry.ts` with the shape `Map<downloadJobId, DownloadJob>` where:

```typescript
interface DownloadJob {
  downloadJobId: string;             // service-minted UUID
  datasourceId: string;
  sourcePath: string;
  targetPath: string;
  bytesDownloaded: number;
  contentLength: number | null;
  startedAt: number;                  // ms epoch
  abortController: AbortController;   // for cancel
}
```

The `files:download` handler SHALL `set` the entry on download start (when minting `downloadJobId`), update `bytesDownloaded` from the engine's `onProgress` callback on **every** tick (so the cancel/failure terminal payloads and `downloads:list-active` read the latest count), and `finalize` the entry on terminal success / failure / cancellation. `finalize` removes the in-memory entry (so `downloads:list-active` and the reverse index no longer see it) AND writes the durable terminal row (see "DownloadRegistry mirrors the download lifecycle to a durable `downloads` table"). The DERIVED `downloading` IPC event (see "Service handler emits `downloading` / terminal events on the IPC stream") is handler-throttled at 1 second OR 10% progress delta — the engine no longer provides an event-bus coalescer, so the handler owns this throttle — with the latest pending progress flushed before the terminal event so the final byte count is never dropped or reordered ahead of the terminal.

The in-memory map SHALL remain the source of truth for live state and for `downloads:list-active`; the live `AbortController` it carries is per-process and is never persisted. The registry SHALL additionally mirror lifecycle transitions to the durable `downloads` SQLite table (see "DownloadRegistry mirrors the download lifecycle to a durable `downloads` table"). Durable history and crash-interrupted bookkeeping are owned by that mirror; download replay/resume after a service crash remains out of scope.

#### Scenario: Registry tracks active download

- **WHEN** a `files:download` for `ds-1 / welcome.pdf → /downloads/welcome.pdf` is in flight at byte offset N
- **THEN** the registry contains exactly one entry keyed by the handler's `downloadJobId` with `bytesDownloaded: N`, `contentLength: <total>`, `targetPath: "/downloads/welcome.pdf"`, `sourcePath: "/welcome.pdf"`, `datasourceId: "ds-1"`, and an active `abortController`

#### Scenario: Registry releases on terminal success

- **WHEN** a `files:download` completes successfully (the handler emits `file-downloaded { downloadJobId }`)
- **THEN** the registry no longer contains the `downloadJobId` entry on the next read

#### Scenario: Registry releases on terminal cancel

- **WHEN** a `files:download` is cancelled mid-stream (the handler emits `download-cancelled { downloadJobId }`)
- **THEN** the registry no longer contains the `downloadJobId` entry on the next read

#### Scenario: Final progress flushes before the terminal event

- **WHEN** a `files:download` completes after several throttled `onProgress` ticks
- **THEN** the handler emits a final `downloading` reflecting the last byte count BEFORE it emits the terminal `file-downloaded` on `sync:event-stream`, and no `downloading` update is emitted after the terminal event

### Requirement: Service drives DownloadRegistry transitions from `onProgress` and the download outcome

The `files:download` handler SHALL drive `DownloadRegistry` state transitions from two in-process sources, NOT from any engine event bus (the engine has no event bus):

- **Progress** — the engine's synchronous `options.onProgress(loaded, total)` callback. On each tick the handler updates the in-flight entry's `bytesDownloaded = loaded` and `contentLength = total` (subject to the handler's 1s-OR-10%-delta throttle on the derived `downloading` event; see "In-memory `DownloadRegistry` tracks active downloads"). The registry's own mirror write is throttled independently (see "DownloadRegistry mirrors the download lifecycle to a durable `downloads` table").
- **Terminal outcome** — the `engine.downloadFile` promise and the returned stream's lifecycle. A clean stream `end` (after the handler's integrity check) is success; a stream `error` / rejected promise is failure; an abort-signal-driven rejection is cancel. On any terminal outcome the handler calls `registry.finalize(downloadJobId, outcome)` with the terminal status it already knows (`completed` / `failed` + tag/message / `cancelled`) and emits the corresponding fs-sync event (`file-downloaded` / `download-failed` / `download-cancelled`) on the IPC stream. `finalize` removes the in-memory entry and persists the terminal `downloads` row.

The handler already holds the `downloadJobId` for the in-flight call in its own closure (it minted it), so progress and terminal correlation require no engine-event lookup. The registry SHALL maintain a reverse index from `(datasourceId, path)` to `downloadJobId`. v1 enforces at most one in-flight download per `(datasourceId, path)`; a second `files:download` request whose `(datasourceId, path)` already exists in the registry SHALL be rejected with `{ ok: false, error: { tag: "other", message: "download already in progress for this entry", retryable: false } }` before any engine call is issued.

#### Scenario: onProgress updates the registry

- **WHEN** the engine invokes `onProgress(524288, 1048576)` for the in-flight download whose registry entry is keyed `downloadJobId: "job-A"`
- **THEN** the entry's `bytesDownloaded` updates to `524288` (subject to the handler throttle) and `contentLength` updates to `1048576`

#### Scenario: Successful download outcome finalizes the registry entry

- **WHEN** `engine.downloadFile`'s returned stream ends cleanly and the handler's integrity check resolves for `downloadJobId: "job-A"`
- **THEN** the registry no longer contains `job-A` in memory; the `downloads` row for `job-A` is `status='completed'` with the final `bytes_downloaded` and a non-null `ended_at`; fs-sync emits `file-downloaded { downloadJobId: "job-A", savedPath, bytes }` on the IPC event channel exactly once (`savedPath` is the handler's pipe target — fs-sync owns it; the engine never writes to disk)

#### Scenario: Cancelled download outcome finalizes the registry entry

- **WHEN** `engine.downloadFile` rejects via the abort signal for `downloadJobId: "job-A"`
- **THEN** the registry no longer contains `job-A` in memory; the `downloads` row for `job-A` is `status='cancelled'` with a non-null `ended_at`; fs-sync emits `download-cancelled { downloadJobId: "job-A", bytesDownloaded, bytesTotal, reason }` on the IPC event channel exactly once

#### Scenario: Concurrent download for the same `(datasourceId, path)` is rejected

- **WHEN** a `files:download { datasourceId: "ds-1", path: "/welcome.pdf", toPath: <…> }` is dispatched while the registry already contains an entry for `(ds-1, /welcome.pdf)`
- **THEN** the handler rejects the second request with `{ ok: false, error: { tag: "other", message: "download already in progress for this entry", retryable: false } }`; no `engine.downloadFile` call is issued for the second request; the first download's registry entry and event stream are unaffected

### Requirement: Service bootstrap composes the full runtime

The service's `main/index.ts` SHALL, after migrations + integrity check + PID guard acquisition and BEFORE opening the IPC listener to new clients, construct and start the full runtime: credential store → service config store → provider registry → client factory → job repository → scheduler (with concurrency semaphore) → network probe → OAuth loopback broker (registered against the auth correlation store and the engine bus) → recovery (running-jobs re-queue) → interrupted-download sweep (terminalize any `downloads` row left `in-flight` by a prior process) → IPC server. The interrupted-download sweep SHALL run after the PID guard is acquired and after the running-jobs recovery, and before the IPC server binds. The IPC server SHALL bind only after every prior step returns without error.

The service SHALL register SIGINT and SIGTERM handlers that, on signal:

1. Stop accepting new connections on the IPC listener.
2. Allow in-flight requests to complete with a bounded grace period (default 5 s).
3. Pause the scheduler (jobs in `running` SHALL be allowed to reach their next persisted state — `completed`, `failed`, `waiting-network` — before shutdown proceeds).
4. Cancel all active OAuth loopback sessions (the broker's `dispose()` closes every pending HTTP server and clears every timer).
5. Close the IPC server, close the DB, release the PID guard, and exit cleanly with code 0.

The service SHALL remain in its run-loop indefinitely until a signal or fatal internal error arrives. "Fatal internal error" SHALL include: IPC listener bind failure after PID-guard acquisition, unrecoverable DB error (e.g., `SQLITE_IOERR`), uncaught exception in the top-level runtime (logged + exit 1).

#### Scenario: Service runs a full request after bootstrap

- **WHEN** the service starts fresh (no existing data dir) with `--dev`
- **THEN** within 3 seconds a client can connect to the dev pipe, send `sync:get-status`, and receive `{ ok: true, result: { ..., runningJobs: 0, queuedJobs: 0 } }`; the PID file exists; `service.log` has lines tagged `bootstrap-complete`

#### Scenario: Bootstrap order is observable

- **WHEN** a test wraps each bootstrap stage in a spy and boots the service
- **THEN** the observed call order is: open DB → run migrations → integrity check → acquire PID guard → construct credential store → construct service config store → construct provider registry → construct client factory → construct scheduler + probe → construct OAuth loopback broker → run `recoverRunningJobs` → run `sweepInterruptedDownloads` → bind IPC listener; the IPC listener's bind SHALL be the LAST observable side-effect before the service enters its idle wait

#### Scenario: SIGINT cancels active OAuth sessions before exit

- **WHEN** the service has one active OAuth correlation (loopback bound, browser tab waiting) and receives SIGINT
- **THEN** before the process exits, the loopback HTTP server is closed (its socket is no longer listening); the `auth-cancelled` event is emitted for the correlation OR no event is emitted (acceptable both ways since the listener tear-down happens during shutdown); the PID file is removed; the process exits with code 0 within 5 seconds

#### Scenario: SIGINT shuts down cleanly

- **WHEN** the service is running with one in-flight `sync:list-jobs` request and receives SIGINT
- **THEN** the list-jobs response is written to the client, the listener stops accepting new connects within 100 ms, the PID file is removed, and the process exits with code 0 within 5 seconds

#### Scenario: IPC bind failure after PID acquisition is fatal

- **WHEN** the PID guard is acquired but binding the IPC listener fails (e.g., pipe path unwritable)
- **THEN** the service logs a fatal error, releases the PID guard, and exits with a non-zero code (specific code = 5); a subsequent invocation SHALL not see a stale PID file

## ADDED Requirements

### Requirement: DownloadRegistry mirrors the download lifecycle to a durable `downloads` table

The `DownloadRegistry` SHALL be the single writer to a durable `downloads` SQLite table and SHALL write through to it on each lifecycle transition. The registry's factory SHALL accept the `db` handle (`createDownloadRegistry(db)`). The registry SHALL remain synchronous (no consumer signature change). The `downloads` table SHALL have columns `download_job_id` (TEXT PRIMARY KEY, equal to the in-memory `downloadJobId`), `datasource_id`, `source_path`, `target_path`, `bytes_downloaded` (INTEGER, default 0), `content_length` (INTEGER nullable), `status` (TEXT, one of `in-flight | completed | failed | cancelled | interrupted`), `failure_tag` (nullable), `failure_message` (nullable), `started_at`, `updated_at`, and `ended_at` (nullable while in-flight), with indexes on `status` and `started_at`.

The write-through mapping SHALL be:

- `set(entry)` — `INSERT` a row with `status='in-flight'`, `bytes_downloaded=0`, `started_at` and `updated_at` set to now, `ended_at` null.
- `update(id, partial)` — `UPDATE bytes_downloaded` / `content_length` / `updated_at`, **throttled**: the registry writes only when `bytes_downloaded` has advanced by at least 10 MB since the last flush OR at least 30 seconds of wall time has elapsed, whichever comes first. The in-memory slot still updates on every call.
- `finalize(id, outcome)` — force-flush the final `bytes_downloaded` (ignoring the throttle), then `UPDATE status` to the terminal status, set `ended_at` and `updated_at` to now, and set `failure_tag` / `failure_message` when the outcome is `failed`. `finalize` also removes the in-memory entry and its reverse-index key.

The five `status` values SHALL exist only in the database; the wire `DownloadJob` shape and `downloads:list-active` are unchanged.

#### Scenario: Start inserts an in-flight row

- **WHEN** the handler mints `downloadJobId: "job-A"` and calls `registry.set(entry)` for `ds-1 / welcome.pdf → /downloads/welcome.pdf`
- **THEN** the `downloads` table contains a row with `download_job_id='job-A'`, `status='in-flight'`, `bytes_downloaded=0`, `content_length` matching the entry, non-null `started_at`, and null `ended_at`

#### Scenario: Progress writes are throttled to milestones

- **WHEN** `registry.update("job-A", { bytesDownloaded })` is called repeatedly with increments smaller than 10 MB and less than 30 seconds apart
- **THEN** the in-memory entry reflects every update, but the `downloads` row's `bytes_downloaded` is rewritten only when the accumulated advance reaches 10 MB OR 30 seconds elapse since the last flush

#### Scenario: Finalize force-flushes and writes the terminal failure row

- **WHEN** a download fails and the handler calls `registry.finalize("job-A", { status: "failed", failureTag: "disconnected", failureMessage: "network lost", bytesDownloaded: 1234 })`
- **THEN** the in-memory entry for `job-A` is removed; the `downloads` row for `job-A` has `status='failed'`, `bytes_downloaded=1234` (force-flushed regardless of the throttle), `failure_tag='disconnected'`, `failure_message='network lost'`, and a non-null `ended_at`

### Requirement: Interrupted downloads are swept to a terminal status on service startup

On startup, after the single-instance PID guard is acquired, the service SHALL run `sweepInterruptedDownloads(db)`, which transitions every `downloads` row still in `status='in-flight'` (necessarily orphaned by a prior process) to `status='interrupted'` and sets its `ended_at` / `updated_at`. The sweep SHALL run only after the PID guard so that only the single-instance-winning process mutates in-flight rows; it SHALL NOT delete the partial files those rows reference (replay/resume is out of scope).

#### Scenario: Orphaned in-flight rows become interrupted on startup

- **WHEN** the service starts (after acquiring the PID guard) and the `downloads` table contains rows left in `status='in-flight'` by a prior process
- **THEN** each such row transitions to `status='interrupted'` with a non-null `ended_at`, and the partial files at their `target_path` are left on disk untouched

#### Scenario: Terminal rows are untouched by the sweep

- **WHEN** the startup sweep runs and the `downloads` table also contains rows with `status` in `completed` / `failed` / `cancelled` / `interrupted`
- **THEN** those rows are not modified by the sweep
