## MODIFIED Requirements

### Requirement: Desktop supervisor connects-or-spawns the sync service

The desktop main process SHALL, during `bootstrap()`, start a `SyncSupervisor` that obtains a connected `SyncClient` to the fs-sync service before the renderer window loads. The supervisor SHALL:

1. Attempt `net.connect` to the production pipe (`\\.\pipe\cloudstash-sync` on Windows, `$HOME/cloudstash/sync_app/sync.sock` on Unix) in prod, or to the dev pipe (`\\.\pipe\cloudstash-sync-dev` / `sync-dev.sock`) in dev.
2. If the connect succeeds, use the resulting socket.
3. If the connect rejects with `ENOENT` or `ECONNREFUSED` in **prod mode only**, spawn the service as a detached child process via `child_process.spawn(command, [servicePath], { detached: true, stdio: 'ignore', env })`, then call `child.unref()` so the service outlives the desktop process. The `command` SHALL be the running application's own executable (`process.execPath`), and `env` SHALL include `ELECTRON_RUN_AS_NODE=1` so that executable runs as a plain Node runtime rather than booting a second Electron application. The service SHALL NOT be spawned via a separately vendored Node binary.
4. After a spawn, retry-connect up to 5 times with geometric backoff (25 / 50 / 100 / 200 / 400 ms). If all retries fail, reject supervisor start with a fatal error surfaced to the renderer.
5. In **dev mode**, do NOT spawn. If the connect fails, surface a clear error message directing the developer to run `pnpm dev` (which starts the service in parallel).

The supervisor SHALL NOT retain any OS-level reference to the spawned child after `unref()`. The supervisor SHALL NOT kill, signal, or wait on the service during `app.quit` / `before-quit` / `will-quit`.

The spawn environment SHALL be supplied by the caller rather than read from `process.env` inside the supervisor, so the choice of runtime is made at the composition root that already knows whether the app is packaged.

Because the service runs on the application's own bundled Node, the service and the desktop process SHALL share one native-module ABI, and the packaged application SHALL therefore contain exactly one compiled copy of any native dependency they both use.

#### Scenario: Prod supervisor connects to an already-running service

- **WHEN** the service is already running with a live PID guard on `service.pid` and the desktop process starts
- **THEN** `net.connect` succeeds on the first attempt, no child process is spawned, and the supervisor yields a ready `SyncClient` within 100 ms of `app.whenReady`

#### Scenario: Prod supervisor spawns a detached service when none is running

- **WHEN** `service.pid` does not exist and the pipe is unreachable, and the desktop process starts in prod mode
- **THEN** the supervisor spawns the service with `detached: true, stdio: 'ignore'`, calls `unref()` on the child, retry-connects within ~1 s, and yields a ready `SyncClient`; killing the desktop process SHALL leave the spawned service alive and still listening on the pipe

#### Scenario: Spawn targets the app's own executable in Node mode

- **WHEN** the prod supervisor reaches the spawn branch
- **THEN** the spawned command is `process.execPath` and the child's environment carries `ELECTRON_RUN_AS_NODE=1`; no path under a vendored `node/` resources directory is referenced

#### Scenario: A packaged build starts its own service

- **WHEN** a packaged application is launched with no sync service already running
- **THEN** the supervisor spawns the bundled service, the connect succeeds within the retry budget, and `sync:*` IPC calls return results rather than rejecting with "sync client not initialized"

#### Scenario: Dev supervisor refuses to spawn

- **WHEN** the desktop starts in dev mode (NODE_ENV=development or --dev flag) and the dev pipe is unreachable
- **THEN** the supervisor does NOT spawn a service, surfaces a user-visible error stating "sync service not running — run `pnpm dev` to start all processes", and desktop exits with a non-zero code (or shows a blocking error window, implementation choice)

#### Scenario: Concurrent desktop starts lose to the PID guard

- **WHEN** two desktop processes start in rapid succession, neither finds a live service, and both attempt to spawn
- **THEN** one spawned service wins the PID guard and begins listening; the other spawned service exits with code 3 within 500 ms; both desktop processes' retry-connect loops find the winning service and proceed normally
