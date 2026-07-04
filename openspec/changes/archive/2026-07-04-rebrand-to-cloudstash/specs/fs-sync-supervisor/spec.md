## MODIFIED Requirements

### Requirement: Desktop supervisor connects-or-spawns the sync service

The desktop main process SHALL, during `bootstrap()`, start a `SyncSupervisor` that obtains a connected `SyncClient` to the fs-sync service before the renderer window loads. The supervisor SHALL:

1. Attempt `net.connect` to the production pipe (`\\.\pipe\cloudstash-sync` on Windows, `$HOME/cloudstash/sync_app/sync.sock` on Unix) in prod, or to the dev pipe (`\\.\pipe\cloudstash-sync-dev` / `sync-dev.sock`) in dev.
2. If the connect succeeds, use the resulting socket.
3. If the connect rejects with `ENOENT` or `ECONNREFUSED` in **prod mode only**, spawn the service as a detached child process via `child_process.spawn(nodeBinary, [servicePath], { detached: true, stdio: 'ignore' })`, then call `child.unref()` so the service outlives the desktop process.
4. After a spawn, retry-connect up to 5 times with geometric backoff (25 / 50 / 100 / 200 / 400 ms). If all retries fail, reject supervisor start with a fatal error surfaced to the renderer.
5. In **dev mode**, do NOT spawn. If the connect fails, surface a clear error message directing the developer to run `pnpm dev` (which starts the service in parallel).

The supervisor SHALL NOT retain any OS-level reference to the spawned child after `unref()`. The supervisor SHALL NOT kill, signal, or wait on the service during `app.quit` / `before-quit` / `will-quit`.

#### Scenario: Prod supervisor connects to an already-running service

- **WHEN** the service is already running with a live PID guard on `service.pid` and the desktop process starts
- **THEN** `net.connect` succeeds on the first attempt, no child process is spawned, and the supervisor yields a ready `SyncClient` within 100 ms of `app.whenReady`

#### Scenario: Prod supervisor spawns a detached service when none is running

- **WHEN** `service.pid` does not exist and the pipe is unreachable, and the desktop process starts in prod mode
- **THEN** the supervisor spawns the service with `detached: true, stdio: 'ignore'`, calls `unref()` on the child, retry-connects within ~1 s, and yields a ready `SyncClient`; killing the desktop process SHALL leave the spawned service alive and still listening on the pipe

#### Scenario: Dev supervisor refuses to spawn

- **WHEN** the desktop starts in dev mode (NODE_ENV=development or --dev flag) and the dev pipe is unreachable
- **THEN** the supervisor does NOT spawn a service, surfaces a user-visible error stating "sync service not running — run `pnpm dev` to start all processes", and desktop exits with a non-zero code (or shows a blocking error window, implementation choice)

#### Scenario: Concurrent desktop starts lose to the PID guard

- **WHEN** two desktop processes start in rapid succession, neither finds a live service, and both attempt to spawn
- **THEN** one spawned service wins the PID guard and begins listening; the other spawned service exits with code 3 within 500 ms; both desktop processes' retry-connect loops find the winning service and proceed normally

### Requirement: Renderer-facing `window.api.sync.*` surface

The preload SHALL expose `window.api.sync` with typed methods that mirror the service's command set, excluding auto-sync commands. The exposed surface SHALL include at minimum:

- `listJobs(filter?: { statuses?: JobStatus[]; datasourceId?: string }): Promise<{ jobs: JobSummary[] }>`
- `getJob(jobId: string): Promise<{ job: JobSummary | null }>`
- `enqueueUpload(params): Promise<{ jobId: string }>`
- `enqueueMirror(params): Promise<{ jobId: string } | { error: SyncAlreadyRunningError }>`
- `cancelJob(jobId: string): Promise<{ cancelled: boolean } | { error: NotCancelableError }>`
- `authenticate(params): Promise<AuthResult>`
- `getStatus(): Promise<{ version: string; serviceUuid: string; runningJobs: number; queuedJobs: number; waitingNetworkJobs: number }>`
- `getRetryPolicy(scope): Promise<RetryPolicy>`
- `setRetryPolicy(scope, policy): Promise<void>`
- `onEvent(callback: (event: ServiceEvent) => void): () => void`

Request/response types SHALL live in a new module under `packages/ipc-contracts/src/sync-service-desktop/` (separate from the on-the-wire `sync-service` module) so renderer code does NOT import wire-format symbols (e.g., `Frame`, `RequestFrame`). The preload SHALL NOT import from `@cloudstash/ipc-contracts/sync-service` (the wire contract); ONLY from `@cloudstash/ipc-contracts/sync-service-desktop` plus `electron`.

#### Scenario: Preload exposes sync methods under window.api.sync

- **WHEN** the renderer at runtime inspects `Object.keys(window.api.sync)`
- **THEN** the result contains exactly `listJobs`, `getJob`, `enqueueUpload`, `enqueueMirror`, `cancelJob`, `authenticate`, `getStatus`, `getRetryPolicy`, `setRetryPolicy`, `onEvent` (order-insensitive; no auto-sync entries)

#### Scenario: Preload does not import wire-format types

- **WHEN** a Vitest test grep-scans `apps/desktop/src/preload/` for imports from `@cloudstash/ipc-contracts/sync-service`
- **THEN** no match is found; matches for `@cloudstash/ipc-contracts/sync-service-desktop` are allowed

#### Scenario: Four-layer wiring per sync method

- **WHEN** a new sync IPC method is added to the renderer surface
- **THEN** the build requires all four layers (contract type in `sync-service-desktop`, main handler under `apps/desktop/src/main/ipc/sync/`, preload `contextBridge` exposure, renderer call site) to be present; missing any one SHALL cause a TypeScript error or a failing contract test

### Requirement: Main-process IPC proxy translates renderer calls to service commands

The desktop main process SHALL register `ipcMain.handle` handlers under `apps/desktop/src/main/ipc/sync/` for every `window.api.sync.*` method. Each handler SHALL:

1. Validate its input against the `sync-service-desktop` contract.
2. Call the corresponding `SyncClient` method.
3. Translate the service response into the `sync-service-desktop` response type (for most calls this is the identity; for `listJobs` the handler SHALL also compute a `derivedSyncingDatasourceIds: string[]` field by grouping returned jobs by `datasourceId` filtered to `kind === 'sync' && status IN ('running', 'queued', 'waiting-network')`).
4. Forward any structured service-side error (e.g., `sync-already-running`, `not-found`) as part of the typed response shape, NOT by throwing at the IPC boundary.

The handler module SHALL NOT import `@cloudstash/fs-datasource-engine` directly — all provider work goes through the service. The handler module MAY import the renderer-facing contract and the `SyncClient`.

#### Scenario: listJobs response is enriched with derived syncing set

- **WHEN** a renderer calls `window.api.sync.listJobs` and the service returns 3 jobs: [{ kind: 'sync', status: 'running', datasourceId: 'ds-1' }, { kind: 'upload', status: 'running', datasourceId: 'ds-1' }, { kind: 'sync', status: 'completed', datasourceId: 'ds-2' }]
- **THEN** the renderer receives `jobs` with those 3 entries AND `derivedSyncingDatasourceIds: ['ds-1']` (exactly — `ds-2` is excluded because its sync is completed)

#### Scenario: Structured errors pass through without throwing

- **WHEN** a renderer calls `window.api.sync.enqueueMirror` for a datasource+path that already has an in-flight sync
- **THEN** the handler does NOT throw at the IPC boundary; the renderer receives a resolved promise with `{ error: { tag: 'sync-already-running', existingJobId } }` shape

### Requirement: Single `pnpm dev` orchestrates desktop + service

The root `package.json` SHALL define a `dev` script that starts — in parallel, in the same terminal — the Electron desktop app in dev mode and the fs-sync service in `--dev` mode. SIGINT on the parent process SHALL propagate to both children, and both SHALL shut down cleanly (service releases its PID guard, desktop closes its windows and exits). The script SHALL NOT require installing any new runtime dependencies beyond what is already in `package.json`.

The service's existing `dev:sync-service` script SHALL remain callable independently for developers who want to run only the service (e.g., to debug service behaviour against an installed prod desktop).

#### Scenario: pnpm dev starts both processes

- **WHEN** a developer runs `pnpm dev` at the repo root
- **THEN** stdout interleaves logs from both children with distinct prefixes; the desktop window loads successfully; the service's `service-dev.pid` file is created; a subsequent `pnpm --filter @cloudstash/fs-sync-service test:smoke` against the dev pipe succeeds

#### Scenario: Ctrl-C exits cleanly

- **WHEN** the developer presses Ctrl-C in the `pnpm dev` terminal
- **THEN** the service's PID file is removed within 2 seconds, the dev pipe is no longer accepting connections, the Electron window closes, and the parent pnpm process exits with code 0 (or 130, the POSIX SIGINT convention)

#### Scenario: No new runtime dependency is introduced

- **WHEN** the PR diff is inspected
- **THEN** no `dependencies` or `devDependencies` block in the root `package.json` gains a new entry attributable to the dev orchestration (pnpm's built-in `-r --parallel` is used, not `concurrently` / `npm-run-all` / similar)
