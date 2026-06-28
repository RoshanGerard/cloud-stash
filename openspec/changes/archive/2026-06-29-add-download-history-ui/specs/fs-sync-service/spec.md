## MODIFIED Requirements

### Requirement: IPC command surface

The service SHALL accept and correctly respond to the following commands on its IPC channel: `sync:enqueue-mirror`, `sync:list-jobs`, `sync:get-job`, `sync:cancel-job`, `sync:cancel-upload`, `sync:cancel-download`, `sync:subscribe-events`, `sync:unsubscribe-events`, `sync:set-retry-policy`, `sync:get-retry-policy`, `sync:authenticate-start`, `sync:authenticate-complete`, `sync:authenticate-cancel`, `sync:get-config`, `sync:set-config`, `sync:delete-credentials`, `sync:get-status`, `files:list`, `files:stat`, `files:search`, `files:remove`, `files:rename`, `files:download`, `files:upload`, `downloads:list-active`, `downloads:clear-history`, `uploads:list-active`. The previous `sync:enqueue-upload` command SHALL NOT be present (replaced by `files:upload` per this change). Request and response types for every command SHALL be declared in `@ft5/ipc-contracts/sync-service` as discriminated unions, keyed by the `command` field. Any command frame whose `command` is not in this enumerated set SHALL receive a response with `ok: false, error.tag === 'unknown-command'`.

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

### Requirement: `sync:get-config` and `sync:set-config` expose the service config to the desktop

The service SHALL accept `sync:get-config` (no parameters) and respond with `{ ok: true, result: { config: ServiceConfig } }` where `ServiceConfig` is the parsed file content (or a default empty shape when the file does not exist). The service SHALL accept `sync:set-config { config: ServiceConfig }` and atomically write the file. Both handlers SHALL preserve the `schemaVersion: 1` invariant.

`ServiceConfig` MAY carry an optional `downloadHistory` field (see "Service config carries optional download-history retention settings"). When `set-config` is given a `config` whose `downloadHistory` is present but invalid (`retentionDays` not in `{30, 90, 180, 365}`, or `autoPrune` not a boolean), the handler SHALL reject with `{ ok: false, error: { tag: "io-error", message } }` and SHALL NOT write the file. The renderer is now a consumer of these commands (via the read-modify-write config helper in the `file-explorer` capability); the service does not itself merge — it writes the `config` it is given wholesale, so callers MUST preserve `providers` and `schemaVersion`.

#### Scenario: get-config returns the empty shape when file is absent

- **WHEN** the service starts with no `<dataDir>/config.json` and a client sends `sync:get-config`
- **THEN** the response is `{ ok: true, result: { config: { schemaVersion: 1, providers: {} } } }`

#### Scenario: set-config writes the file atomically and round-trips through get-config

- **WHEN** a client sends `sync:set-config { config: { schemaVersion: 1, providers: { "google-drive": { clientId: "X", clientSecret: "Y" } } } }` and then `sync:get-config`
- **THEN** the second response carries the exact same content; the file at `<dataDir>/config.json` has mode 0o600 on Unix; a subsequent `sync:authenticate-start { providerId: "google-drive" }` no longer returns `service-config-missing`

#### Scenario: set-config round-trips downloadHistory

- **WHEN** a client sends `sync:set-config { config: { schemaVersion: 1, providers: {}, downloadHistory: { autoPrune: false, retentionDays: 180 } } }` and then `sync:get-config`
- **THEN** the second response's `config.downloadHistory` is `{ autoPrune: false, retentionDays: 180 }`

#### Scenario: set-config rejects an invalid retentionDays

- **WHEN** a client sends `sync:set-config { config: { schemaVersion: 1, providers: {}, downloadHistory: { autoPrune: true, retentionDays: 45 } } }`
- **THEN** the response is `{ ok: false, error: { tag: "io-error", message } }` and `<dataDir>/config.json` is not modified

### Requirement: Service bootstrap composes the full runtime

The service's `main/index.ts` SHALL, after migrations + integrity check + PID guard acquisition and BEFORE opening the IPC listener to new clients, construct and start the full runtime: credential store → service config store → provider registry → client factory → job repository → scheduler (with concurrency semaphore) → network probe → OAuth loopback broker (registered against the auth correlation store and the engine bus) → recovery (running-jobs re-queue) → interrupted-download sweep (terminalize any `downloads` row left `in-flight` by a prior process) → config-gated download-history prune (start the autonomous retention scheduler) → IPC server. The interrupted-download sweep SHALL run after the PID guard is acquired and after the running-jobs recovery, and before the IPC server binds. The config-gated download-history prune scheduler SHALL start after the interrupted-download sweep and before the IPC server binds; its first prune runs synchronously at startup, and it then re-prunes every 24 hours (see "Config-gated download-history auto-prune"). The prune scheduler is part of the composed runtime but is NOT an observable bootstrap stage — it fires no `onStage` (autonomous retention enforcement), so it does not appear in the observable stage order below. The IPC server SHALL bind only after every prior step returns without error.

The service SHALL register SIGINT and SIGTERM handlers that, on signal:

1. Stop accepting new connections on the IPC listener.
2. Allow in-flight requests to complete with a bounded grace period (default 5 s).
3. Pause the scheduler (jobs in `running` SHALL be allowed to reach their next persisted state — `completed`, `failed`, `waiting-network` — before shutdown proceeds).
4. Cancel all active OAuth loopback sessions (the broker's `dispose()` closes every pending HTTP server and clears every timer).
5. Clear the download-history auto-prune timer, close the IPC server, close the DB, release the PID guard, and exit cleanly with code 0.

The service SHALL remain in its run-loop indefinitely until a signal or fatal internal error arrives. "Fatal internal error" SHALL include: IPC listener bind failure after PID-guard acquisition, unrecoverable DB error (e.g., `SQLITE_IOERR`), uncaught exception in the top-level runtime (logged + exit 1).

#### Scenario: Service runs a full request after bootstrap

- **WHEN** the service starts fresh (no existing data dir) with `--dev`
- **THEN** within 3 seconds a client can connect to the dev pipe, send `sync:get-status`, and receive `{ ok: true, result: { ..., runningJobs: 0, queuedJobs: 0 } }`; the PID file exists; `service.log` has lines tagged `bootstrap-complete`

#### Scenario: Bootstrap order is observable

- **WHEN** a test wraps each bootstrap stage in a spy and boots the service
- **THEN** the observed call order is: open DB → run migrations → integrity check → acquire PID guard → construct credential store → construct service config store → construct provider registry → construct client factory → construct scheduler + probe → construct OAuth loopback broker → run `recoverRunningJobs` → run `sweepInterruptedDownloads` → bind IPC listener; the IPC listener's bind SHALL be the LAST observable side-effect before the service enters its idle wait. (The config-gated download-history prune runs between `sweepInterruptedDownloads` and the IPC bind but fires no `onStage`, so it is not an observed stage.)

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

### Requirement: Service config carries optional download-history retention settings

`ServiceConfig` (in `@ft5/ipc-contracts/sync-service`) SHALL gain an optional field `downloadHistory?: { autoPrune: boolean; retentionDays: 30 | 90 | 180 | 365 }`. The field is additive at the unchanged config `schemaVersion: 1` (an existing `config.json` without the field remains valid). When the field is absent OR malformed (wrong shape, `retentionDays` out of the preset set, or `autoPrune` non-boolean), every reader SHALL fall back to the default `{ autoPrune: true, retentionDays: 90 }`. The default SHALL be applied at the read site (the prune scheduler and the set-config validator), because `ServiceConfigStore.read`'s `as ServiceConfig` cast does not validate the field's shape.

#### Scenario: Absent downloadHistory yields the default

- **WHEN** a reader resolves retention settings from a `config.json` that has no `downloadHistory` field
- **THEN** the resolved settings are `{ autoPrune: true, retentionDays: 90 }`

#### Scenario: Malformed downloadHistory yields the default

- **WHEN** a reader resolves retention settings from a `config.json` whose `downloadHistory` is `{ autoPrune: "yes", retentionDays: 7 }` (both fields invalid)
- **THEN** the resolved settings are `{ autoPrune: true, retentionDays: 90 }`

### Requirement: Config-gated download-history auto-prune

The service SHALL run `pruneDownloadHistory(db, { maxAgeMs })`, which deletes every `downloads` row whose `status` is not `in-flight` AND whose `ended_at` is older than `now - maxAgeMs`. A scheduler SHALL resolve the current retention settings (see "Service config carries optional download-history retention settings") on service start — after the startup interrupted-sweep introduced by `migrate-download-registry-to-sqlite` — and every 24 hours thereafter: when `autoPrune` is enabled it SHALL prune with `maxAgeMs = retentionDays * 86_400_000`; when disabled it SHALL skip pruning. The 24-hour timer SHALL be cleared on service shutdown. Pruning SHALL never delete `in-flight` rows and SHALL never delete on-disk files. (The `downloads` table and its `status` / `ended_at` columns are owned by `migrate-download-registry-to-sqlite`.)

#### Scenario: Auto-prune deletes aged terminal rows when enabled

- **WHEN** the scheduler runs with `{ autoPrune: true, retentionDays: 90 }` and the `downloads` table holds a `completed` row whose `ended_at` is 91 days old and a `failed` row whose `ended_at` is 10 days old
- **THEN** the 91-day-old row is deleted and the 10-day-old row remains; no on-disk file is touched

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

The service SHALL accept `downloads:clear-history` with request `{ filter?: { status?: DownloadTerminalStatus[]; olderThanMs?: number } }` and respond with `{ ok: true, value: { deleted: number } }`, where `deleted` is the number of rows removed. With no `filter`, the handler SHALL delete all terminal rows (`status != 'in-flight'`). A `status` filter SHALL restrict the delete to those terminal statuses; an `olderThanMs` filter SHALL restrict to rows whose `ended_at` is older than `now - olderThanMs`; both filters combine (AND). The handler SHALL never delete `in-flight` rows and SHALL never delete on-disk files. The handler SHALL emit no event/broadcast (the renderer toaster renders only in-flight downloads, which this never touches).

#### Scenario: Clear with no filter deletes all terminal rows

- **WHEN** a client sends `downloads:clear-history { }` and the table holds 3 terminal rows and 1 `in-flight` row
- **THEN** the 3 terminal rows are deleted, the `in-flight` row remains, the response is `{ ok: true, value: { deleted: 3 } }`, and no on-disk file is touched

#### Scenario: Clear with a status filter deletes only those statuses

- **WHEN** a client sends `downloads:clear-history { filter: { status: ["failed", "interrupted"] } }` and the table holds 2 `failed`, 1 `interrupted`, and 2 `completed` rows
- **THEN** only the 3 `failed`/`interrupted` rows are deleted; the 2 `completed` rows remain; the response is `{ ok: true, value: { deleted: 3 } }`

#### Scenario: Clear with an age filter deletes only old terminal rows

- **WHEN** a client sends `downloads:clear-history { filter: { olderThanMs: <30 days> } }` and the table holds a `completed` row 40 days old and a `cancelled` row 5 days old
- **THEN** only the 40-day-old row is deleted; the response is `{ ok: true, value: { deleted: 1 } }`

#### Scenario: Clear never deletes in-flight rows

- **WHEN** a client sends `downloads:clear-history { filter: { olderThanMs: 0 } }` and the table holds an `in-flight` row of any age
- **THEN** the `in-flight` row is not deleted

### Requirement: `DownloadTerminalStatus` is the wire vocabulary for terminal download statuses

`@ft5/ipc-contracts/sync-service` SHALL export `DownloadTerminalStatus = 'completed' | 'failed' | 'cancelled' | 'interrupted'` (the four terminal `downloads.status` values; `in-flight` is excluded). This is the first promotion of the download-status vocabulary to the wire — `migrate-download-registry-to-sqlite` keeps the five statuses confined to the database. `DownloadTerminalStatus` SHALL be the type of the `status` filter on `downloads:clear-history`.

#### Scenario: The terminal-status type excludes in-flight

- **WHEN** the `DownloadTerminalStatus` union is enumerated
- **THEN** it contains exactly `completed`, `failed`, `cancelled`, `interrupted` and does NOT contain `in-flight`
