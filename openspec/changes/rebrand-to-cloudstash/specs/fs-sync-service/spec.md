## RENAMED Requirements

- FROM: `### Requirement: Data directory layout at `$HOME/ft5/sync_app``
- TO: `### Requirement: Data directory layout at `$HOME/cloudstash/sync_app``

- FROM: `### Requirement: `ServiceConfigStore` reads `~/ft5/sync_app/config.json` for OAuth app config`
- TO: `### Requirement: `ServiceConfigStore` reads `~/cloudstash/sync_app/config.json` for OAuth app config`

- FROM: `### Requirement: Development builds may bypass authenticate via `FT5_DEV_CREDENTIALS` (service-side)`
- TO: `### Requirement: Development builds may bypass authenticate via `CLOUDSTASH_DEV_CREDENTIALS` (service-side)`

## MODIFIED Requirements

### Requirement: Service is a framework-agnostic, per-user Node.js daemon

The sync service SHALL live at `services/fs-sync/` as a pnpm workspace entry. It SHALL import only from `@cloudstash/ipc-contracts`, `@cloudstash/fs-datasource-engine`, Drizzle ORM (`drizzle-orm`, `better-sqlite3`), Node.js built-ins (`net`, `fs`, `fs/promises`, `crypto`, `path`, `dns/promises`, `os`, `child_process`), and its own internal modules. It SHALL NOT import from `electron`, `@electron/*`, any path under `apps/desktop/`, or any renderer-scoped specifier. The service SHALL run under the identity of the current OS user and SHALL NOT require elevated privileges (no Administrator on Windows, no root on macOS/Linux) to start, serve requests, or execute jobs.

#### Scenario: No Electron or desktop-app imports in the service

- **WHEN** a Vitest test grep-scans every `.ts` file under `services/fs-sync/src/`
- **THEN** no file contains an import specifier matching `electron`, `@electron/`, or any path starting with `apps/desktop/`

#### Scenario: Service starts without elevated privileges

- **WHEN** the service binary is launched in a CI container running as a non-root user with no sudoers entry
- **THEN** the service enters its main loop, opens its IPC listener, and serves a subsequent `sync:get-job` command for a nonexistent id with a `not-found` response

### Requirement: Data directory layout at `$HOME/cloudstash/sync_app`

The service SHALL create and use a data directory at `$HOME/cloudstash/sync_app/` (resolved via `os.homedir()`; on Windows this resolves to `%USERPROFILE%\cloudstash\sync_app\`). The directory SHALL contain the files `credentials.json`, `sync.db`, `service.pid`, `service.log`, and (on Unix prod only) `sync.sock`. The environment variable `CLOUDSTASH_SYNC_DATA_DIR`, when set, SHALL override the data directory root for the lifetime of the process. The service SHALL create any missing directories or files on first start, with directory mode `0700` on Unix and a user-only ACL on Windows.

#### Scenario: Data dir is created on first start

- **WHEN** the service starts with `$HOME/cloudstash/sync_app/` not present and `CLOUDSTASH_SYNC_DATA_DIR` unset
- **THEN** the directory is created with mode `0700`, and subsequent file writes inside it succeed

#### Scenario: `CLOUDSTASH_SYNC_DATA_DIR` override is honoured

- **WHEN** the service starts with `CLOUDSTASH_SYNC_DATA_DIR=/tmp/cloudstash-test-$RANDOM`
- **THEN** `credentials.json`, `sync.db`, and all runtime files are created under that directory; nothing is written to `$HOME/cloudstash/sync_app/`

### Requirement: Named-pipe JSON-line IPC transport

The service SHALL listen for client connections on a named-pipe path. In production mode the path SHALL be `\\.\pipe\cloudstash-sync` on Windows and `$HOME/cloudstash/sync_app/sync.sock` on Unix. In development mode the path SHALL be `\\.\pipe\cloudstash-sync-dev` on Windows and `$HOME/cloudstash/sync_app/sync-dev.sock` on Unix. The protocol SHALL be newline-delimited JSON frames; each frame is one of `Request { id, kind: "request", command, params }`, `Response { id, kind: "response", ok, result | error }`, or `Event { kind: "event", name, payload }`. The connection SHALL be bidirectional: the client writes requests; the server writes responses AND unsolicited event frames on the same stream. Request/response correlation SHALL use the `id` field. On Unix, the socket file SHALL be created with mode `0600`.

#### Scenario: Prod service listens on the production pipe

- **WHEN** the service starts without `--dev`
- **THEN** `net.connect('\\\\.\\pipe\\cloudstash-sync')` succeeds on Windows and `net.connect($HOME + '/cloudstash/sync_app/sync.sock')` succeeds on Unix

#### Scenario: Dev service listens on the dev pipe only

- **WHEN** the service starts with `--dev`
- **THEN** a client connecting to the prod pipe path receives `ECONNREFUSED` (or equivalent), and a client connecting to the dev pipe path succeeds

#### Scenario: Request / response correlation by id

- **WHEN** a client sends two `sync:list-jobs` requests concurrently with ids `"a"` and `"b"`
- **THEN** the client observes two response frames, each with a matching `id`, and responses MAY arrive in either order without being dropped or mis-routed

#### Scenario: Unix socket file permissions

- **WHEN** the service starts on Linux or macOS and creates `$HOME/cloudstash/sync_app/sync.sock`
- **THEN** `fs.stat` of the socket reports mode bits with no group or other access (`(stat.mode & 0o077) === 0`)

### Requirement: IPC command surface

The service SHALL accept and correctly respond to the following commands on its IPC channel: `sync:enqueue-mirror`, `sync:list-jobs`, `sync:get-job`, `sync:cancel-job`, `sync:cancel-upload`, `sync:cancel-download`, `sync:subscribe-events`, `sync:unsubscribe-events`, `sync:set-retry-policy`, `sync:get-retry-policy`, `sync:authenticate-start`, `sync:authenticate-complete`, `sync:authenticate-cancel`, `sync:get-config`, `sync:set-config`, `sync:delete-credentials`, `sync:get-status`, `files:list`, `files:stat`, `files:search`, `files:remove`, `files:rename`, `files:download`, `files:upload`, `downloads:list-active`, `downloads:clear-history`, `downloads:delete-partial`, `downloads:list-leftover`, `uploads:list-active`. The previous `sync:enqueue-upload` command SHALL NOT be present (replaced by `files:upload` per this change). Request and response types for every command SHALL be declared in `@cloudstash/ipc-contracts/sync-service` as discriminated unions, keyed by the `command` field. Any command frame whose `command` is not in this enumerated set SHALL receive a response with `ok: false, error.tag === 'unknown-command'`.

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

### Requirement: Single-instance guard via PID file

On startup, the service SHALL write its PID to `$HOME/cloudstash/sync_app/service.pid` (prod) or `service-dev.pid` (dev). If the PID file exists and references a currently-live process whose executable image name matches the service binary name, the new instance SHALL log the collision and exit with code `3`. If the referenced PID is not alive, OR it is alive but has a non-matching image name (stale reuse), the new instance SHALL overwrite the PID file and proceed normally.

#### Scenario: Second instance refuses to start

- **WHEN** the service is already running with PID 1234 recorded in `service.pid` (its process is alive), and a second invocation starts
- **THEN** the second process exits with code `3` within 500 ms and the first process continues serving requests

#### Scenario: Stale PID is overwritten

- **WHEN** `service.pid` references PID 1 (init, not the service) AND the service is invoked
- **THEN** the service overwrites the PID file with its own PID and proceeds to open the IPC listener

### Requirement: `ConfigFileCredentialStore` implements the engine's `CredentialStore` port

The service SHALL provide a class `ConfigFileCredentialStore` in `services/fs-sync/src/credential-store/config-file.ts` implementing the engine's `CredentialStore` interface exactly. Storage SHALL be plaintext JSON at `$HOME/cloudstash/sync_app/credentials.json` in the shape `{ "schemaVersion": 1, "credentials": { [datasourceId]: StoredCredentials } }`. Writes SHALL be atomic (write to a `credentials.json.tmp` sibling, then `fs.rename`). After every write on Unix, the file SHALL be `fchmod`-ed to `0600`. The store SHALL NOT depend on `electron` or `safeStorage`.

#### Scenario: Credentials round-trip through the store

- **WHEN** a test invokes `store.put("ds-1", { accessToken: "abc", refreshToken: "def" })` and then `store.get("ds-1")`
- **THEN** `get` resolves with an object structurally equal to the input; the on-disk file contains the literal strings `"abc"` and `"def"` (plaintext is expected)

#### Scenario: Atomic write survives a crash

- **WHEN** a test simulates a process crash between the temp-file write and the `rename`
- **THEN** on restart, `store.get` still returns the previous successfully-committed value; no `credentials.json.tmp` residue remains after a subsequent successful `put` (the subsequent `rename` cleans it up atomically)

#### Scenario: Delete removes the entry but keeps the file

- **WHEN** `store.delete("ds-1")` is called with two datasources `"ds-1"` and `"ds-2"` present
- **THEN** the file persists with `{ schemaVersion: 1, credentials: { "ds-2": ... } }`; a subsequent `store.get("ds-1")` resolves to `null`

### Requirement: SQLite database schema and migrations

The service SHALL open a SQLite database at `$HOME/cloudstash/sync_app/sync.db` using `better-sqlite3`, with `journal_mode = WAL` and `synchronous = NORMAL`. Schema SHALL be defined via Drizzle ORM at `services/fs-sync/src/db/schema.ts` and SHALL include at least the tables `service_meta`, `jobs`, `sync_snapshot`, `retry_policies`, `downloads`. Migrations SHALL live under `services/fs-sync/drizzle/` and run forward-only on service start. The `downloads` table SHALL be introduced by a new forward-only migration `services/fs-sync/drizzle/0002_downloads.sql`, and `CURRENT_SCHEMA_VERSION` SHALL be `2`. The service SHALL run `PRAGMA integrity_check` on startup and, if the result is not `"ok"`, SHALL log a fatal error and exit with code `4`.

#### Scenario: Fresh database is initialized on first start

- **WHEN** the service starts against an empty `CLOUDSTASH_SYNC_DATA_DIR`
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

### Requirement: Service consumes the engine only through `ClientFactory`

Every `DatasourceClient<T>` used by any executor SHALL be obtained by calling `ClientFactory.create(providerId, credentials, { bus, credentialStore })` from `@cloudstash/fs-datasource-engine`. No executor SHALL instantiate a concrete client class (`S3Client`, `OneDriveClient`, `GoogleDriveClient`) directly. No file under `services/fs-sync/src/` SHALL import from `@aws-sdk/client-s3`, `@microsoft/microsoft-graph-client`, or `googleapis`.

#### Scenario: Factory is the single entry point

- **WHEN** a test spies on `ClientFactory.create` and enqueues upload jobs against three different datasourceIds
- **THEN** `ClientFactory.create` is invoked for each unique datasourceId (cached across subsequent jobs for the same id is allowed), and no concrete client class's constructor is called directly in any test

#### Scenario: No provider SDKs in the service

- **WHEN** a Vitest test grep-scans every `.ts` file under `services/fs-sync/src/` for provider SDK specifiers
- **THEN** no match is found

### Requirement: Installer registers and deregisters the per-user service

The `apps/desktop` electron-builder configuration SHALL invoke platform-specific post-install and post-uninstall hooks that register or deregister the sync service as a per-user OS service:

- **Windows:** post-install runs `schtasks /Create /SC ONLOGON /TN "cloudstash-sync" /TR <servicePath> /RL LIMITED /F`; post-uninstall runs `schtasks /Delete /TN "cloudstash-sync" /F`. Both commands SHALL execute under the current user context and SHALL NOT require Administrator elevation.
- **macOS:** post-install writes `~/Library/LaunchAgents/com.cloudstash.sync.plist` with `RunAtLoad=true` and `KeepAlive=true`, then runs `launchctl load ~/Library/LaunchAgents/com.cloudstash.sync.plist`; post-uninstall runs `launchctl unload ...` and deletes the plist.
- **Linux:** post-install writes `~/.config/systemd/user/cloudstash-sync.service`, runs `systemctl --user enable --now cloudstash-sync.service`, and runs `loginctl enable-linger <user>`; post-uninstall runs `systemctl --user disable --now cloudstash-sync.service` and deletes the unit.

No third-party service-manager library SHALL be introduced; only OS-native CLIs SHALL be used.

#### Scenario: Windows install creates the scheduled task

- **WHEN** the installer post-install hook runs on Windows in a test container with the user in scope
- **THEN** `schtasks /Query /TN "cloudstash-sync"` returns exit code 0 and the task's "Run as user" field matches the current user; no UAC prompt occurred

#### Scenario: macOS install loads the launchd agent

- **WHEN** the installer post-install hook runs on macOS in a test VM
- **THEN** `launchctl list | grep com.cloudstash.sync` finds a matching line, and the corresponding plist file exists at `~/Library/LaunchAgents/com.cloudstash.sync.plist`

#### Scenario: Uninstall removes all traces

- **WHEN** the uninstall hook runs after a successful install on any supported OS
- **THEN** the per-OS query (`schtasks /Query`, `launchctl list`, `systemctl --user status`) reports no such entry, and the registration file (plist / unit) does not exist on disk

### Requirement: Dev mode uses distinct pipe, data dir, and PID file

When launched with `--dev`, the service SHALL (a) listen on the dev pipe path (see transport requirement), (b) use `CLOUDSTASH_SYNC_DATA_DIR=$HOME/cloudstash/sync_app/dev/` by default (overridable), (c) write its PID to `service-dev.pid`, (d) log at `debug` level to stderr in addition to `service.log`. A dev-mode service SHALL coexist with a prod-mode service on the same machine without interference: starting a dev service with a prod service already running SHALL succeed, and vice versa.

#### Scenario: Dev and prod services coexist

- **WHEN** a prod service is running (listening on the prod pipe, PID in `service.pid`), and a dev service is launched with `--dev`
- **THEN** the dev service starts successfully, listens on the dev pipe, writes `service-dev.pid`, and the prod service continues serving its existing connections without interruption

#### Scenario: Dev pipe is not reachable from prod clients

- **WHEN** a test client configured with the prod pipe path attempts to connect while only the dev service is running
- **THEN** the connect attempt returns `ENOENT` (Unix) or `ECONNREFUSED` (Windows), and no request is delivered to the dev service

### Requirement: `sync:authenticate` is the canonical credential-writing entry point

The service SHALL accept the three-command authenticate split as the only path that writes to `ConfigFileCredentialStore`. No other component in the repository SHALL write to the credential store outside of (a) these three handlers and (b) the engine's `BaseDatasourceClient` single-flight refresh path (which already writes through the injected `CredentialStore`). Desktop main SHALL NOT have a local credential store.

`sync:authenticate-start` accepts `{ providerId: ProviderId, datasourceId?: string }` and responds with `{ ok: true, result: { correlationId: string, kind: "oauth" } } | { ok: true, result: { correlationId: string, kind: "credentials-form", formSchema } } | { ok: false, error }`. The handler SHALL:
1. Read the per-provider OAuth app config (for OAuth-class providers) via `ServiceConfigStore.getOAuthAppConfig(providerId)`. On `ServiceConfigMissingError`, respond `{ ok: false, error: { tag: "service-config-missing", path, providerId } }`.
2. Construct the engine client via `factory.createForAuth(providerId, oauthAppConfig | null, ctx)`.
3. Call `client.authenticate()` to obtain the live `AuthIntent`.
4. Stash the intent in `AuthCorrelationStore` and obtain a `correlationId`.
5. For `intent.kind === "oauth"`: hand off to `OAuthLoopbackBroker.start({ correlationId, providerId, datasourceId, intent })` which binds the loopback, builds the final authorize URL with state + PKCE, and emits `oauth-open-url` carrying the URL. Respond `{ ok: true, result: { correlationId, kind: "oauth" } }`.
6. For `intent.kind === "credentials-form"`: extract the form schema and respond `{ ok: true, result: { correlationId, kind: "credentials-form", formSchema } }`.
7. Emit `auth-initiated` with `{ correlationId, providerId, datasourceId? }`.

`sync:authenticate-complete` accepts `{ correlationId: string, completion: { kind: "credentials-form", values } }` (the `kind: "oauth"` completion arrives from the loopback callback inside the service, not from the renderer). The handler SHALL:
1. Consume the correlation via `AuthCorrelationStore.consume(correlationId)`. On miss, respond `{ ok: false, error: { tag: "correlation-expired", correlationId } }`.
2. Validate `intent.kind === completion.kind`. On mismatch, respond `{ ok: false, error: { tag: "intent-kind-mismatch", expected, actual } }`.
3. For credentials-form: invoke `intent.submit(completion.values)`. The engine's `decorateIntent` writes the resulting `AuthResult` via `credentialStore.put(datasourceId, …)`.
4. Construct a `DatasourceSummary` and emit `credential-persisted { correlationId, datasourceId, summary }` AND `auth-completed { correlationId, datasourceId, summary }`.

`sync:authenticate-cancel` accepts `{ correlationId: string }` and idempotently:
1. Consumes the correlation if present (`AuthCorrelationStore.consume`).
2. Calls `OAuthLoopbackBroker.cancel({ correlationId })` if a loopback session exists for it (idempotent no-op otherwise).
3. Emits `auth-cancelled { correlationId }` exactly once per active correlation. A second cancel for the same `correlationId` SHALL be a no-op (no event, no error).

The OAuth-class loopback callback path (inside the service) drives the OAuth completion without a renderer round-trip: on a valid `/callback` HTTP request, the broker invokes `intent.completeWith(code)`, the engine's `decorateIntent` writes credentials, and the broker emits `credential-persisted` + `auth-completed` events identical in shape to the credentials-form path.

#### Scenario: OAuth start returns kind=oauth and emits oauth-open-url

- **WHEN** a client sends `sync:authenticate-start { providerId: "google-drive" }` with the service config populated for Google Drive
- **THEN** the response is `{ ok: true, result: { correlationId: <uuid>, kind: "oauth" } }`; the next event on the stream is `auth-initiated`; the next event after that is `oauth-open-url` carrying `{ correlationId, authorizeUrl }`; the loopback HTTP server is bound on `127.0.0.1:<port>`; `factory.createForAuth("google-drive", oauthAppConfig, ctx)` was invoked exactly once

#### Scenario: OAuth completion writes credentials via the loopback and emits credential-persisted

- **WHEN** a test simulates a valid GET to the loopback `/callback?code=valid-code&state=<correct-state>` for an active OAuth correlation
- **THEN** the broker invokes `intent.completeWith("valid-code")` exactly once; `credentialStore.put(datasourceId, AuthResult)` is invoked exactly once; the next two events on the stream are `credential-persisted { correlationId, datasourceId, summary }` and `auth-completed { correlationId, datasourceId, summary }`; the loopback server is closed; the correlation is consumed

#### Scenario: Credentials-form completion writes credentials via the request/response handler

- **WHEN** a client sends `sync:authenticate-start { providerId: "amazon-s3" }`, gets a `correlationId`, and then sends `sync:authenticate-complete { correlationId, completion: { kind: "credentials-form", values: { accessKeyId, secretAccessKey, region } } }`
- **THEN** the response is `{ ok: true, result: { datasourceId, summary } }`; `intent.submit(values)` was invoked exactly once; `credentialStore.put(datasourceId, AuthResult)` was invoked exactly once; the next two events on the stream are `credential-persisted` and `auth-completed`

#### Scenario: Service-config-missing on OAuth start

- **WHEN** a client sends `sync:authenticate-start { providerId: "google-drive" }` and `~/cloudstash/sync_app/config.json` does not exist (or has empty `clientId`)
- **THEN** the response is `{ ok: false, error: { tag: "service-config-missing", path: <abs path>, providerId: "google-drive" } }`; no engine client is constructed; no event is emitted; no loopback server is bound

#### Scenario: Cancel is idempotent and emits exactly once per active correlation

- **WHEN** a client sends `sync:authenticate-cancel { correlationId }` twice in succession for an active OAuth correlation
- **THEN** the first cancel emits `auth-cancelled { correlationId }` exactly once and closes the loopback server; the second cancel returns `{ ok: true, result: { cancelled: false } }` (already-cancelled), emits NO event, and does NOT throw

#### Scenario: Correlation expired returns the typed error

- **WHEN** a client sends `sync:authenticate-complete { correlationId, completion }` 6 minutes after `sync:authenticate-start` returned the correlation (default TTL is 5 minutes)
- **THEN** the response is `{ ok: false, error: { tag: "correlation-expired", correlationId } }`; no `credentialStore.put` call occurs; no `auth-completed` event is emitted

#### Scenario: No other writer to credentials.json

- **WHEN** a Vitest test grep-scans every `.ts` file under `services/fs-sync/src/` and `apps/desktop/src/` for calls to `ConfigFileCredentialStore.prototype.put` or equivalent
- **THEN** the only call sites are inside (a) the three authenticate handlers (or modules they call: the loopback broker + the credentials-form complete path), (b) the engine's `BaseDatasourceClient` refresh path (invoked via the injected store), and (c) the `sync:delete-credentials` deletion path; NO match exists under `apps/desktop/src/`

### Requirement: `ServiceConfigStore` reads `~/cloudstash/sync_app/config.json` for OAuth app config

The service SHALL own a `ServiceConfigStore` module under `services/fs-sync/src/config/`. The store SHALL be constructed at bootstrap and SHALL be the single point of truth for per-provider OAuth app configuration during the service's process lifetime.

The store SHALL read from `<dataDir>/config.json` (where `dataDir` is the same directory that contains `credentials.json`). The schema SHALL be:

```json
{
  "schemaVersion": 1,
  "providers": {
    "<providerId>": { "clientId": "<string>", "clientSecret": "<string>" }
  }
}
```

`getOAuthAppConfig(providerId): OAuthAppConfig` SHALL:
- Return `{ clientId, clientSecret, redirectUri }` for the requested provider when the file exists, parses successfully, and the provider entry has non-empty `clientId` and `clientSecret`. The `redirectUri` field is computed by the broker at session-start time, NOT stored in the file.
- Throw `ServiceConfigMissingError` (a typed error class with `path` and `providerId` fields) when (a) the file is absent, OR (b) the file exists but cannot be parsed, OR (c) the file parses but does not contain an entry for `providerId`, OR (d) the provider entry's `clientId` or `clientSecret` is the empty string.

The store SHALL NEVER auto-create the config file. The repo SHALL ship a committed template at `services/fs-sync/config.example.json` containing the provider keys (`google-drive`, `onedrive`) with empty values.

A `getRaw()` method SHALL return the parsed file content for the `sync:get-config` handler. A `setRaw(next)` method SHALL atomically write the file (write-to-tmp + rename) with mode 0o600 on Unix, mirroring the existing `ConfigFileCredentialStore` pattern.

#### Scenario: getOAuthAppConfig returns the populated entry

- **WHEN** the file exists with `providers["google-drive"] = { clientId: "abc", clientSecret: "def" }` and a test calls `store.getOAuthAppConfig("google-drive")` (with a redirectUri-injecting closure)
- **THEN** the call resolves with `{ clientId: "abc", clientSecret: "def", redirectUri: <the-injected-uri> }`

#### Scenario: getOAuthAppConfig throws ServiceConfigMissingError when file is absent

- **WHEN** `<dataDir>/config.json` does not exist and a test calls `store.getOAuthAppConfig("google-drive")`
- **THEN** the call throws `ServiceConfigMissingError` whose `path` is the absolute resolved file path and `providerId` is `"google-drive"`

#### Scenario: getOAuthAppConfig throws when entry has empty clientId

- **WHEN** the file exists with `providers["google-drive"] = { clientId: "", clientSecret: "def" }` and a test calls `store.getOAuthAppConfig("google-drive")`
- **THEN** the call throws `ServiceConfigMissingError`; the error's `providerId` is `"google-drive"`

#### Scenario: getRaw + setRaw round-trip

- **WHEN** a test calls `store.setRaw({ schemaVersion: 1, providers: { "google-drive": { clientId: "x", clientSecret: "y" } } })` and then `store.getRaw()`
- **THEN** the round-tripped value matches; the file at `<dataDir>/config.json` exists with mode 0o600 on Unix; a subsequent `store.getOAuthAppConfig("google-drive")` (with redirectUri injection) succeeds

#### Scenario: Committed template exists and parses

- **WHEN** a test reads `services/fs-sync/config.example.json` from the repo
- **THEN** the file is valid JSON; the parsed object has `schemaVersion === 1` and a `providers` object with at least `google-drive` and `onedrive` keys; both keys have empty-string `clientId` and `clientSecret` values

### Requirement: `service-config-missing` is the canonical error tag for absent or incomplete OAuth app config

The service's authenticate-start handler SHALL surface `ServiceConfigMissingError` as the wire error `{ tag: "service-config-missing", path: string, providerId: string }`. The tag SHALL be a member of the `SyncAuthenticateStartErrorTag` discriminated union exported from `@cloudstash/ipc-contracts/sync-service`. The tag SHALL NOT appear on the credentials-form path (S3, custom) — those providers do not consult the OAuth app config.

The renderer's `oauth-form` failure-state rendering SHALL recognize the tag and surface user-facing copy that includes the absolute file `path` and a pointer to the per-provider OAuth registration section in `README.md`.

#### Scenario: Tag is exposed by the contract

- **WHEN** a contract type test imports `SyncAuthenticateStartErrorTag` from `@cloudstash/ipc-contracts/sync-service`
- **THEN** the union contains `"service-config-missing"`; the corresponding error shape includes `path: string` and `providerId: string`

#### Scenario: OAuth start returns the typed error when config is incomplete

- **WHEN** the service's authenticate-start handler is invoked with `providerId: "google-drive"` and `ServiceConfigStore.getOAuthAppConfig` throws `ServiceConfigMissingError`
- **THEN** the response is `{ ok: false, error: { tag: "service-config-missing", path: <absolute>, providerId: "google-drive" } }`

#### Scenario: Credentials-form path does not surface the tag

- **WHEN** a test invokes the authenticate-start handler with `providerId: "amazon-s3"` and the config file is empty
- **THEN** the handler does NOT call `ServiceConfigStore.getOAuthAppConfig`; the response is `{ ok: true, result: { correlationId, kind: "credentials-form", formSchema } }`

### Requirement: Service event stream carries the `auth-*` event taxonomy

The service event stream (delivered to subscribed clients via `SYNC_CHANNELS.event` per the `fs-sync-supervisor` capability) SHALL emit the following events with the listed payload shapes:

| Event | Payload | Producer |
|---|---|---|
| `auth-initiated` | `{ correlationId: string, providerId: ProviderId, datasourceId?: string }` | `sync:authenticate-start` |
| `auth-completed` | `{ correlationId: string, datasourceId: string, summary: DatasourceSummary }` | OAuth loopback callback / credentials-form complete handler |
| `auth-cancelled` | `{ correlationId: string }` | `sync:authenticate-cancel`; OAuth loopback timer (only when cancel was the trigger) |
| `auth-failed` | `{ correlationId: string, tag: AuthFailedTag, message?: string }` | OAuth loopback (state mismatch, completeWith reject); engine errors during `submit` |
| `auth-timeout` | `{ correlationId: string }` | OAuth loopback 5-minute timer |
| `oauth-open-url` | `{ correlationId: string, authorizeUrl: string }` | `sync:authenticate-start` (oauth kind only) |
| `credential-persisted` | `{ correlationId: string, datasourceId: string, summary: DatasourceSummary }` | OAuth loopback callback / credentials-form complete handler |

`auth-completed` and `credential-persisted` SHALL fire as a pair (both, in either order) at every successful authenticate completion. Their distinct identities exist so the desktop event-bridge can filter `oauth-open-url` and `credential-persisted` out of the renderer-bound forward (they are bridge-only) while still letting the renderer consume `auth-completed`.

The event union type SHALL be exported from `@cloudstash/ipc-contracts/sync-service` as a discriminated union keyed by `event` with the corresponding payload field at the top level (consistent with the existing job-* events).

#### Scenario: All seven events are present in the contract

- **WHEN** a contract type test imports the `SyncEvent` union from `@cloudstash/ipc-contracts/sync-service`
- **THEN** every event name in the table above is a member of the union; payloads narrow correctly under `switch (e.event)` in TypeScript

#### Scenario: auth-completed and credential-persisted fire together on OAuth success

- **WHEN** a test runs an end-to-end OAuth completion against an active session
- **THEN** both `auth-completed` and `credential-persisted` events are emitted exactly once each for the same `correlationId` and `datasourceId`; their relative order is unspecified

#### Scenario: Bridge-only events are filtered before renderer forward

- **WHEN** a desktop event-bridge test subscribes to `oauth-open-url` and `credential-persisted` AND has a renderer-window subscriber registered
- **THEN** the bridge's renderer-forward path forwards every `auth-*` event but does NOT forward `oauth-open-url` or `credential-persisted`; the bridge-internal path consumes both bridge-only events for `shell.openExternal` and `registry.add` respectively

### Requirement: Development builds may bypass authenticate via `CLOUDSTASH_DEV_CREDENTIALS` (service-side)

When the service process starts with `process.env.CLOUDSTASH_DEV_CREDENTIALS === "1"`, the OAuth loopback broker SHALL log a single warning line (`⚠ CLOUDSTASH_DEV_CREDENTIALS active — browser consent bypassed`) on first `start(...)` call within the process, and subsequent `start(...)` calls for OAuth-class providers SHALL: (a) read `<dataDir>/dev-credentials.json` via the existing `ConfigFileCredentialStore` shape; (b) skip HTTP server binding and `oauth-open-url` emission; (c) emit `auth-completed` and `credential-persisted` synchronously (next tick) using the file-derived credentials; (d) NOT bind a loopback listener, NOT generate state, NOT emit `oauth-open-url`. In packaged production builds the env var SHALL NEVER be set — the service installer SHALL NOT propagate it into the service's runtime environment.

#### Scenario: Dev override short-circuits the browser flow

- **WHEN** a test starts the service with `CLOUDSTASH_DEV_CREDENTIALS=1`, a valid `dev-credentials.json` in the fixture data dir, and a stubbed loopback HTTP-server constructor
- **THEN** a `sync:authenticate-start { providerId: "google-drive" }` resolves; no HTTP server is bound; no `oauth-open-url` event is emitted; the next events on the stream are `auth-completed` and `credential-persisted` (carrying a synthetic correlationId) within one tick

#### Scenario: Production service does not propagate the env var

- **WHEN** a smoke test inspects the packaged service binary's embedded env / startup logs
- **THEN** `CLOUDSTASH_DEV_CREDENTIALS` is not in the packaged process env; the warning line is NOT printed on production startup

#### Scenario: Startup warning fires once when dev override is active

- **WHEN** the service starts with `CLOUDSTASH_DEV_CREDENTIALS=1` and three `sync:authenticate-start` calls run in sequence
- **THEN** exactly one log line matching `/CLOUDSTASH_DEV_CREDENTIALS active/` is emitted across the lifetime of the broker; no further warnings fire on subsequent `start(...)` calls

### Requirement: `files:rename` and `files:download` RPC commands delegate to the engine

The service SHALL accept two new commands on its IPC channel:
`files:rename` and `files:download`. Both SHALL resolve the engine client
for the request's `datasourceId` via the existing `ClientFactory`
machinery (the same path used by `files:list`, `files:stat`,
`files:search`, `files:remove`).

`files:rename` accepts:

```typescript
{
  datasourceId: string;
  path: string;
  handle?: string;
  newName: string;
  conflictPolicy: "fail" | "overwrite" | "keep-both";
}
```

The handler forwards the call to `client.rename(target, newName,
conflictPolicy)`, wrapped in the engine's `withAuthRefresh(client, op)`
helper so a stale-but-refreshable token refreshes once and retries before
the error surfaces. The engine's strategy determines whether the target
is a file or directory within its own provider context (Drive/OneDrive
metadata, S3 `HeadObject` + `ListObjectsV2` introspection); the wire
contract carries no `kind` field. Response: `{ ok: true, value: {
entry: DatasourceFileEntry } } | { ok: false, error }`. Error tags
include the new `"conflict"` variant carrying `existingPath` per the
engine's new `DatasourceErrorTag.Conflict`.

`files:download` accepts:

```typescript
{
  datasourceId: string;
  path: string;
  handle?: string;
  toPath: string;  // required, absolute, validated at boundary
  conflictPolicy?: "fail" | "overwrite" | "keep-both";  // default "fail"
}
```

The handler MUST first validate `toPath` (see "toPath validation" requirement below). After validation, the handler SHALL run the destination-conflict gate (see "files:download handler gates on existing toPath via conflictPolicy" requirement below) BEFORE the concurrency guard, the engine client resolution, the registry insert, and the cycle loop. On success, the handler:

1. Mints a service-level `downloadJobId` (UUID) and creates an `AbortController` for the job. Inserts a registry entry. The registry's `targetPath` field carries the `effectiveTargetPath` — equal to `toPath` for `"fail"` and `"overwrite"` policies; equal to the suffix-resolved free filename for `"keep-both"`.
2. Enters a retry loop. Initial iteration: `rangeStart = 0`. Each iteration calls `engine.downloadFile(target, { rangeStart, signal: abortController.signal, onProgress: <fires service-level downloading event> })`.
3. Validates the response: if `rangeStart > 0` and `contentRange === undefined` (provider ignored the Range header), throws a terminal `range-not-supported` error.
4. Validates: if `rangeStart > 0` and `contentRange.start !== rangeStart`, throws a terminal `range-mismatch` error.
5. Pipes the returned stream to `fs.createWriteStream(effectiveTargetPath, { flags: rangeStart === 0 ? "w" : "r+", start: rangeStart })`.
6. After the pipeline resolves, reads `fs.stat(effectiveTargetPath).size` to determine `bytesWritten`. If `bytesWritten === contentLength`, breaks out of the loop (success).
7. If `engine.downloadFile` rejects with an `auth-expired` error — either the initial GET (before any bytes stream) or the pipeline mid-stream — AND the per-cycle auth-retry budget (`MAX_AUTH_RETRIES`, default 1) is not exhausted, the handler explicitly calls `client.refreshCredentials()` once, sets `rangeStart = bytesWritten` from the file size on disk (0 if nothing has been written yet), and re-issues `engine.downloadFile`. The engine NO LONGER auto-refreshes — the handler owns the refresh. If the re-issued call AGAIN returns `auth-expired` immediately after a successful `refreshCredentials()`, the refresh token is dead and the handler surfaces `auth-revoked` (no further retry).
8. If the pipeline rejects with `abortController.signal.aborted`, emits `download-cancelled` and returns the cancel response.
9. If the pipeline rejects with any other error, emits `download-failed` and returns the error response.
10. After successful loop exit, performs an integrity check (compare hash of `effectiveTargetPath` against the provider's hash if available) and emits `file-downloaded { downloadJobId, savedPath: effectiveTargetPath, bytes }`. Replies `{ ok: true, value: { savedPath: effectiveTargetPath, bytes } }`. Removes the registry entry.

The `downloadJobId` SHALL be the canonical job key for cancel and progress correlation; clients reference it in `downloads:list-active`, in cancel commands, and in event subscriptions.

#### Scenario: Successful download streams from engine to disk

- **WHEN** a client sends `files:download { datasourceId: "ds-1", path: "/welcome.pdf", toPath: "/Users/alice/Downloads/CloudStash/welcome.pdf", conflictPolicy: "fail" }` and no file exists at the destination
- **THEN** `toPath` validation passes; the conflict gate sees no file at the destination; the handler mints `downloadJobId`, creates the registry entry with `targetPath === toPath`, calls `engine.downloadFile(target, { rangeStart: 0, signal, onProgress })`; `engine.downloadFile` resolves with `{ stream, contentLength: N }`; the handler pipes the stream to `fs.createWriteStream(toPath, { flags: "w", start: 0 })`; on stream end the handler reads `fs.stat(toPath).size === N`; integrity check passes; the handler emits `file-downloaded { downloadJobId, savedPath: toPath, bytes: N }` and replies `{ ok: true, value: { savedPath: toPath, bytes: N } }`; the registry entry is removed

#### Scenario: Pre-stream auth-expired refreshes then retries

- **WHEN** a `files:download` is dispatched; the initial `engine.downloadFile(target, { rangeStart: 0, … })` GET rejects with `tag: "auth-expired"` before any bytes stream
- **THEN** the handler calls `client.refreshCredentials()` exactly once, then re-issues `engine.downloadFile(target, { rangeStart: 0, signal, onProgress })`; the post-refresh GET resolves with `{ stream, contentLength: N }`; the download proceeds to completion and replies `{ ok: true, value: { savedPath, bytes: N } }`

#### Scenario: Mid-stream auth-expired triggers handler-driven refresh and retry

- **WHEN** a `files:download` is in flight; after N bytes are written, the pipeline rejects with `tag: "auth-expired"`
- **THEN** the handler reads `fs.stat(effectiveTargetPath).size === N`; calls `client.refreshCredentials()` exactly once; sets `rangeStart = N`; re-issues `engine.downloadFile(target, { rangeStart: N, signal, onProgress })`; the post-refresh GET returns 206 Partial Content with `Content-Range: bytes N-M/T`; the handler validates `contentRange.start === N`; pipes from byte N (using `flags: "r+", start: N`); on stream end `fs.stat(effectiveTargetPath).size === contentLength`; the loop exits with success

#### Scenario: Refresh that does not clear auth-expired surfaces auth-revoked

- **WHEN** a `files:download` GET rejects with `auth-expired`, the handler calls `client.refreshCredentials()`, and the re-issued `engine.downloadFile` GET AGAIN rejects with `auth-expired`
- **THEN** the handler treats the refresh token as dead: it does NOT refresh a second time, emits `download-failed`, and replies `{ ok: false, error: { tag: "auth-revoked", … } }`

#### Scenario: A failing `refreshCredentials()` itself surfaces auth-revoked

- **WHEN** a `files:download` GET rejects with `auth-expired` and the handler's `client.refreshCredentials()` call ITSELF rejects (e.g. the refresh token is revoked, so `refreshTokenImpl` throws a typed `auth-revoked` `DatasourceError`)
- **THEN** the handler does NOT swallow the refresh rejection and does NOT re-issue the GET; the typed error propagates to the terminal catch, `normalizeFilesError` maps it to wire `auth-revoked`, `download-failed` is emitted, and the reply is `{ ok: false, error: { tag: "auth-revoked", … } }`

#### Scenario: Range-not-honored aborts with terminal error

- **WHEN** during a retry iteration, `engine.downloadFile(target, { rangeStart: N, … })` resolves with `contentRange === undefined` (provider ignored the Range header and returned 200 OK)
- **THEN** the handler does NOT pipe the stream; throws a terminal `range-not-supported` error; emits `download-failed { downloadJobId, tag: "other", message: "range not supported on this resource" }`; the partial file at `effectiveTargetPath` is left on disk; the registry entry is removed

#### Scenario: Cancel mid-stream

- **WHEN** the client invokes a cancel command (or the download orchestration emits a cancel) while the pipeline is in flight; the handler invokes `abortController.abort()`
- **THEN** the engine's downloaded stream rejects via the AbortSignal; the pipeline rejects with AbortError; the handler emits `download-cancelled { downloadJobId, bytesDownloaded, bytesTotal, reason: "user" }` exactly once; the partial file at `effectiveTargetPath` is NOT auto-deleted; the registry entry is removed; the response is `{ ok: false, error: { tag: "cancelled", message: "download cancelled" } }`

#### Scenario: Long download with a single mid-stream token expiry resumes after one re-auth

- **WHEN** a `files:download` is in flight against a provider whose access token expires once mid-stream after N bytes
- **THEN** the pipeline rejects `auth-expired`; the handler calls `client.refreshCredentials()` exactly once, sets `rangeStart = N`, and re-issues `engine.downloadFile`; the post-refresh GET returns 206 Partial Content; pipe-to-disk resumes from byte N; total bytes written equals `contentLength`; the integrity check passes; the download succeeds
- **AND** the handler permits at most ONE auth-expired refresh-and-retry per download (the per-cycle `MAX_AUTH_RETRIES` budget is 1 and the cycle loop runs once for current strategies); a SECOND `auth-expired` within the same download surfaces `auth-revoked` — a pre-existing bound on long-download re-authentication, unchanged by this migration

#### Scenario: Rename file via the new RPC

- **WHEN** a client sends `files:rename { datasourceId: "ds-1", path: "/foo.pdf", newName: "bar.pdf", conflictPolicy: "fail" }`
- **THEN** the handler resolves the engine client for `ds-1`, calls `client.rename(target, "bar.pdf", "fail")`, the strategy determines via its provider context that the target is a file, performs the rename, and on success the handler replies `{ ok: true, value: { entry: { path: "/bar.pdf", name: "bar.pdf", … } } }`; the engine emits `entry-renamed` exactly once

#### Scenario: Rename directory on Drive

- **WHEN** a client sends `files:rename { datasourceId: "ds-drive", path: "/projects", newName: "archive", conflictPolicy: "fail" }` against a Drive folder
- **THEN** the handler calls `client.rename(target, "archive", "fail")`; the Drive strategy issues `files.update({fileId, requestBody: {name: "archive"}})` (uniform API for files and folders); on success the handler replies with the renamed entry

#### Scenario: Rename directory on S3 surfaces unsupported

- **WHEN** a client sends `files:rename { datasourceId: "ds-s3", path: "/backups", newName: "archive", conflictPolicy: "fail" }` against an S3 virtual folder
- **THEN** the handler calls `client.rename(target, "archive", "fail")`, the S3 strategy's introspection (`HeadObject` 404 + `ListObjectsV2` returns at least one key) determines the target is a folder, the strategy rejects with `DatasourceError { tag: "unsupported", message: "S3 folder rename is not supported in this version" }`, and the response is `{ ok: false, error: { tag: "other", message: "S3 folder rename is not supported in this version", retryable: false } }`

### Requirement: `toPath` validation at the service boundary

The `files:download` handler SHALL validate the renderer-supplied `toPath`
before opening any write stream. Validations:

1. `path.isAbsolute(toPath)` is true.
2. `path.normalize(toPath) === toPath` (no `..` segments after
   normalization).
3. The parent directory exists and is writable
   (`fs.access(parent, fs.constants.W_OK)` succeeds).
4. The path does not write inside the service's own data directory
   (`~/cloudstash/sync_app/`). Service-private paths are off-limits to
   download writes.

Validation failure SHALL produce `{ ok: false, error: { tag: "other",
message: "toPath validation: <which check failed>", retryable: false } }`
without opening any provider request.

#### Scenario: Relative toPath is rejected

- **WHEN** a client sends `files:download` with `toPath: "Downloads/welcome.pdf"`
- **THEN** the handler rejects with `tag: "other", message: "toPath validation: not absolute"`; no engine call is made

#### Scenario: Path traversal in toPath is rejected

- **WHEN** a client sends `files:download` with `toPath: "/Users/alice/Downloads/../../../etc/passwd"`
- **THEN** the handler normalizes the path, sees the result differs from the input (or sees `..` post-normalize is impossible because `path.normalize` would resolve), and rejects with `tag: "other", message: "toPath validation: contains traversal"`

#### Scenario: Write into service data dir is rejected

- **WHEN** a client sends `files:download` with `toPath: "$HOME/cloudstash/sync_app/credentials.json"`
- **THEN** the handler rejects with `tag: "other", message: "toPath validation: cannot write inside service data directory"`

### Requirement: `FilesErrorTag` includes `exhausted-retries`

The wire-level `FilesErrorTag` enumeration in `@cloudstash/ipc-contracts` SHALL include the value `"exhausted-retries"`. This tag SHALL be emitted exclusively by the `files:download` handler's environmental-retry exhaustion paths (consecutive-failure budget exhausted OR wall-time ceiling exceeded). Both exhaustion modes share the same tag; the discriminator (count vs wall-time) lives in the message field as `"exhausted-retries: <engineCause>"` or `"walltime-exceeded: <engineCause>"`.

The renderer's `download-failed` toast logic SHALL recognize `tag: "exhausted-retries"` and present the existing Retry affordance; the failure presentation SHALL include the message text so the user can read what kind of exhaustion occurred.

#### Scenario: Tag is exposed at the wire level

- **WHEN** TypeScript code imports `FilesErrorTag` from `@cloudstash/ipc-contracts`
- **THEN** `"exhausted-retries"` is one of the type's literal members; tools that exhaustively switch on `FilesErrorTag` see it as a required case

#### Scenario: Renderer treats the new tag like an existing failure

- **WHEN** the renderer receives `download-failed { downloadJobId, datasourceId, tag: "exhausted-retries", message: "exhausted-retries: network-error" }`
- **THEN** the failure toast renders with the existing failed-state appearance, the Retry button is enabled, and the toast text includes the message string verbatim

### Requirement: `FilesErrorTag` values are referenced via the const object, not raw string literals

Every TypeScript source and test file SHALL reference `FilesErrorTag`
values through the `FilesErrorTag` const object exported from
`@cloudstash/ipc-contracts` (e.g. `FilesErrorTag.Disconnected`) — across the
workspace (`packages/`, `services/`, `apps/`, `scripts/`, `tools/`) — rather than
the equivalent raw string literal (e.g. `"disconnected"`) in any
error-tag context: construction (`tag: ...`), comparison (`tag === ...` /
`tag !== ...`), or `switch`/`case` arm. This is a behavior-preserving convention:
the const's value IS the same string, so the `files:*` envelope wire
shape and the derived `FilesErrorTag` union are unchanged.

This convention SHALL be enforced by TWO complementary mechanisms that
agree on the same tag vocabulary and field set:

- The const-convention **guard test**
  (`packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts`)
  — a non-bypassable CI/test-time backstop that grep-scans the workspace.
- A custom **ESLint rule** `cloudstash/no-raw-error-tag-literal`
  (`tools/eslint-rules/no-raw-error-tag-literal.mjs`, wired as an inline
  plugin in `eslint.config.mjs`) — an AST rule providing editor-time
  feedback and opt-in suggestions. It is syntactic (no type services); it
  SHALL NOT apply an autofix via `--fix` (a wrong-enum substitution on a
  shared value is type-safe and test-green, so it MUST NOT be auto-applied),
  but MAY offer opt-in ESLint suggestions to the const reference.

The following are explicitly EXEMPT and MAY remain raw strings:

- The const-object definition itself in
  `packages/ipc-contracts/src/files.ts`.
- Serialized protocol payloads — JSON inside MSW handlers, recorded
  provider-response fixtures, or any string asserted as the on-the-wire
  value rather than a typed `FilesErrorTag` value.
- `openspec/specs/**/*.md` (documents wire values; off-limits to direct
  edits) and code comments.
- `dist/` build outputs and `node_modules/`.
- Type-position declarations — `readonly tag:` interface members and
  string-literal union types (e.g. event-payload tag unions) — which
  DECLARE a contract's allowed tag values (definitions, peers of the const
  object), not value references. The ESLint rule, visiting value positions
  only, never flags these without a dedicated exemption.
- Literals belonging to a DIFFERENT error vocabulary that happens to share
  the string. `AuthFailedTag` (the `auth-failed` event payload) is a plain
  type union with no const object and is out of scope; its `auth-revoked` /
  `provider-error` literals stay raw — recorded in the guard allowlist and
  carrying an `// eslint-disable-next-line cloudstash/no-raw-error-tag-literal --
  <reason>` for the rule.

Because the five values shared with `DatasourceErrorTag` (`auth-revoked`,
`rate-limited`, `conflict`, `cancelled`, `invalid-datasource`) are
type-identical across both enums, each site SHALL use the const whose
enum matches the declared type of the value at that site; the compiler
does not distinguish them, so enum-correctness is review-enforced.

#### Scenario: No raw `FilesErrorTag` literals remain outside exemptions

- **WHEN** the const-convention guard test (`packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts`) grep-scans every `.ts` / `.tsx` file under `packages/`, `services/`, `apps/`, `scripts/`, and `tools/` for raw error-tag string literals in an error-tag context (`tag` / `errorTag` / `lastErrorTag` / `engineCause` / `.tag` construction or comparison, and `case` arms)
- **THEN** it finds zero occurrences of any `FilesErrorTag` value as a raw literal, excluding the const definition, serialized-payload fixtures, comments, `dist/`, and `node_modules/`

#### Scenario: `files:*` envelope vocabulary is unchanged

- **WHEN** the migration replaces a literal such as `tag: "exhausted-retries"` on a `FilesErrorEnvelope` with `tag: FilesErrorTag.ExhaustedRetries`
- **THEN** the runtime value, the `files:*` envelope wire shape, and the `FilesErrorTag` derived union are byte-identical, and the existing fs-sync + renderer test suites pass unchanged

#### Scenario: ESLint rule enforces the `FilesErrorTag` convention in the editor

- **WHEN** a developer writes a `FilesErrorTag` value (e.g. `tag: "disconnected"`) as a raw literal in an enforced error-tag context and ESLint evaluates `cloudstash/no-raw-error-tag-literal`
- **THEN** the rule reports the violation and offers an opt-in suggestion to `FilesErrorTag.Disconnected` (inserting the `@cloudstash/ipc-contracts` import if absent); for one of the five shared values it offers both the `FilesErrorTag.*` and `DatasourceErrorTag.*` suggestions; the rule never applies a fix via `eslint --fix`

### Requirement: Service config carries optional download-history retention settings

`ServiceConfig` (in `@cloudstash/ipc-contracts/sync-service`) SHALL gain an optional field `downloadHistory?: { autoPrune: boolean; retentionDays: 30 | 90 | 180 | 365 }`. The field is additive at the unchanged config `schemaVersion: 1` (an existing `config.json` without the field remains valid). When the field is absent OR malformed (wrong shape, `retentionDays` out of the preset set, or `autoPrune` non-boolean), every reader SHALL fall back to the default `{ autoPrune: true, retentionDays: 90 }`. The default SHALL be applied at the read site (the prune scheduler and the set-config validator), because `ServiceConfigStore.read`'s `as ServiceConfig` cast does not validate the field's shape.

#### Scenario: Absent downloadHistory yields the default

- **WHEN** a reader resolves retention settings from a `config.json` that has no `downloadHistory` field
- **THEN** the resolved settings are `{ autoPrune: true, retentionDays: 90 }`

#### Scenario: Malformed downloadHistory yields the default

- **WHEN** a reader resolves retention settings from a `config.json` whose `downloadHistory` is `{ autoPrune: "yes", retentionDays: 7 }` (both fields invalid)
- **THEN** the resolved settings are `{ autoPrune: true, retentionDays: 90 }`

### Requirement: `DownloadTerminalStatus` is the wire vocabulary for terminal download statuses

`@cloudstash/ipc-contracts/sync-service` SHALL export `DownloadTerminalStatus = 'completed' | 'failed' | 'cancelled' | 'interrupted'` (the four terminal `downloads.status` values; `in-flight` is excluded). This is the first promotion of the download-status vocabulary to the wire — `migrate-download-registry-to-sqlite` keeps the five statuses confined to the database. `DownloadTerminalStatus` SHALL be the type of the `status` filter on `downloads:clear-history`.

#### Scenario: The terminal-status type excludes in-flight

- **WHEN** the `DownloadTerminalStatus` union is enumerated
- **THEN** it contains exactly `completed`, `failed`, `cancelled`, `interrupted` and does NOT contain `in-flight`
