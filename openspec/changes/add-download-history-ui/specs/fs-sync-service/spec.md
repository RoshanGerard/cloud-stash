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
