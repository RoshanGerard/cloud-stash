## MODIFIED Requirements

### Requirement: IPC command surface

The service SHALL accept and correctly respond to the following commands on its IPC channel: `sync:enqueue-mirror`, `sync:list-jobs`, `sync:get-job`, `sync:cancel-job`, `sync:cancel-upload`, `sync:cancel-download`, `sync:subscribe-events`, `sync:unsubscribe-events`, `sync:set-retry-policy`, `sync:get-retry-policy`, `sync:authenticate-start`, `sync:authenticate-complete`, `sync:authenticate-cancel`, `sync:get-config`, `sync:set-config`, `sync:delete-credentials`, `sync:get-status`, `files:list`, `files:stat`, `files:search`, `files:remove`, `files:rename`, `files:download`, `files:upload`, `downloads:list-active`, `downloads:clear-history`, `downloads:delete-partial`, `uploads:list-active`. The previous `sync:enqueue-upload` command SHALL NOT be present (replaced by `files:upload` per this change). Request and response types for every command SHALL be declared in `@ft5/ipc-contracts/sync-service` as discriminated unions, keyed by the `command` field. Any command frame whose `command` is not in this enumerated set SHALL receive a response with `ok: false, error.tag === 'unknown-command'`.

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

### Requirement: Service handler emits `downloading` / terminal events on the IPC stream

The `files:download` handler SHALL emit consumer-domain events on the service's IPC event channel. These events are DERIVED, not relayed: fs-sync drives them from the engine's `downloadFile` call — its `options.onProgress` callback for progress, and the call's promise resolution / rejection (and the returned stream's lifecycle) for the terminal outcome — and applies a business-logic transformation — minting a `downloadJobId`, throttling progress, running the integrity check post-pipe, applying retry policy, updating the DownloadRegistry — before emitting fs-sync's own desktop-facing events. The fs-sync wire shapes differ from the engine's raw progress facts: the engine's `onProgress` reports raw `(loaded, total)` byte counts keyed by `(datasourceId, path)`; fs-sync payloads are keyed by `downloadJobId` and carry business-decoration metadata. fs-sync events are NOT a re-broadcast of engine events.

The fs-sync wire shapes:

- `downloading { downloadJobId, datasourceId, progress, path, bytesLoaded, bytesTotal }` — high-frequency progress; throttling is performed by the handler itself (1 second OR 10% progress-delta window), because the engine no longer provides an event-bus coalescer; the latest pending progress update SHALL be flushed before the terminal event so the final byte count is never dropped or emitted after the terminal. The `progress` field SHALL be the integer percentage when `bytesTotal !== null && bytesTotal > 0` (computed as `floor(bytesLoaded / bytesTotal * 100)`, clamped to `[0..100]`); the `progress` field SHALL be `0` when `bytesTotal === null` or `bytesTotal === 0`. The `bytesLoaded` field SHALL be the integer number of bytes drained from the engine response stream. The `bytesTotal` field SHALL be the **best-known total size of the resource**: the engine response's `contentLength` (the value of the `Content-Length` HTTP header parsed as an integer) when present, OR the metadata-derived `size` field captured by the handler's pre-cycle `client.getMetadata(target)` prefetch (see "Requirement: `files:download` handler prefetches resource size before the cycle loop" below), OR `null` when both sources are absent. Renderers SHALL prefer `(bytesLoaded, bytesTotal)` as the source of truth for display, falling back to a bytes-only progress format when `bytesTotal` is null (see file-explorer spec.md "Download toast renders combined percent+size when total is known, falls back to bytes-only when total is unknown").
- `download-retrying { downloadJobId, datasourceId, attempt, limit, waitMs, engineCause }` — emitted at the start of each environmental-retry sleep (NOT for the auth-expired Layer 2 branch). One event per retry attempt; not coalesced.
- `file-downloaded { downloadJobId, datasourceId, savedPath, bytes }` — terminal success.
- `download-failed { downloadJobId, datasourceId, tag, message, partialKept? }` — terminal failure.
- `download-cancelled { downloadJobId, datasourceId, bytesDownloaded, bytesTotal, reason }` — terminal cancel.

The `partialKept` field on `download-failed` is OPTIONAL (absent is equivalent to `false`). It SHALL be `true` when the terminal disposition preserves the partial file on disk — i.e. the terminal cause is NOT in the delete-on-terminal set (see "Requirement: Terminal failure disposition deletes the partial file when bytes are corrupt-and-not-recoverable") — AND at least one byte was written (`bytesDownloaded > 0`). It SHALL be absent or `false` otherwise: a delete-disposition failure (the partial was unlinked before emit), or a failure before any byte reached disk. `partialKept` is a UI hint only — renderers use it to decide whether to offer a delete-partial affordance — and SHALL NOT alter the disposition policy.

The handler invokes the engine's `onProgress` callback hook to drive the synchronous progress accounting (registry updates and the handler-throttled `downloading` IPC emission). Terminal events emit exactly once per download. The handler treats the engine's `downloadFile` promise resolution / rejection (and the returned stream's lifecycle) as the canonical source for the terminal outcome; the synchronous `onProgress` callback is the low-overhead direct-caller path that drives the byte-flow accounting.

A client subscribed via `sync:subscribe-events` for a specific `datasourceId` SHALL receive only events for that datasource; subscriptions without a filter SHALL receive all events.

#### Scenario: Downloading progress streams to subscriber

- **WHEN** a client subscribes via `sync:subscribe-events { datasourceId: "ds-1" }` and a `files:download` is in flight for `ds-1` against a provider that returns `Content-Length: 398458880`
- **THEN** the client receives `downloading { downloadJobId, datasourceId: "ds-1", progress: <0..100>, path, bytesLoaded: <0..398458880>, bytesTotal: 398458880 }` events at the throttled rate; on terminal completion the client receives exactly one `file-downloaded { downloadJobId, savedPath, bytes }`

#### Scenario: Downloading progress with provider-omitted Content-Length surfaces null bytesTotal

- **WHEN** a client subscribes via `sync:subscribe-events { datasourceId: "ds-1" }` and a `files:download` is in flight for `ds-1` against a provider that returns no `Content-Length` header (e.g., chunked transfer encoding for large media)
- **THEN** the client receives `downloading { downloadJobId, datasourceId: "ds-1", progress: 0, path, bytesLoaded: <growing integer>, bytesTotal: null }` events at the throttled rate; the `progress` field stays `0` throughout (since total is unknown) but `bytesLoaded` increments toward the file's true size; on terminal completion the client receives exactly one `file-downloaded { downloadJobId, savedPath, bytes }`

#### Scenario: download-failed carries partialKept true when the partial is kept

- **WHEN** a `files:download` fails with a KEEP-disposition terminal cause (e.g. `tag: "exhausted-retries"`) after at least one byte was written to disk
- **THEN** the emitted `download-failed` event carries `partialKept: true`

#### Scenario: download-failed carries partialKept false when the partial was deleted

- **WHEN** a `files:download` fails with a DELETE-disposition terminal cause (range-mismatch or integrity-failed), so the handler unlinks the partial before emitting the terminal event
- **THEN** the emitted `download-failed` event carries `partialKept: false` (or omits the field)

## ADDED Requirements

### Requirement: `downloads:delete-partial` deletes a recorded terminal partial file

The service SHALL accept a command `downloads:delete-partial` with params `{ downloadJobId: string }` and respond `{ ok: true, value: { deleted: boolean } }` on success. The handler SHALL resolve the partial file's path server-side from the durable `downloads` table row for `downloadJobId` — clients SHALL NOT pass a filesystem path over IPC. The handler SHALL be dispatched with access to the durable `downloads` table and a filesystem `unlink`, and SHALL NOT resolve an engine client.

The handler SHALL apply a "recorded + KEEP-eligible-terminal" guard and map filesystem errors:

1. If no `downloads` row exists for `downloadJobId`, respond `{ ok: true, value: { deleted: false } }` (no-op success — nothing is recorded to delete).
2. If the row's `status` is NOT a KEEP-eligible terminal status — i.e. it is `in-flight` (the file is being actively written) or `completed` (the `target_path` is a full, successful download, NOT a partial) — unlink nothing and respond with an error envelope whose `error` carries a message. Only `failed`, `cancelled`, and `interrupted` rows leave a deletable partial.
3. Otherwise `unlink` the row's `target_path`:
   - success → `{ ok: true, value: { deleted: true } }`;
   - `ENOENT` (file already gone) → `{ ok: true, value: { deleted: true } }` (the desired end state is reached);
   - `EACCES` / `EPERM` (or other unlink error) → an error envelope whose `error` carries the reason, so the caller can surface it.

The command SHALL NOT distinguish kept-vs-deleted disposition from the database (the `downloads` table has no disposition column); a delete-disposition row whose file was already unlinked simply resolves via the ENOENT-as-success path.

#### Scenario: Deletes a recorded terminal partial

- **WHEN** a `downloads:delete-partial { downloadJobId }` arrives for a row whose `status` is terminal (`failed`) and whose `target_path` exists on disk
- **THEN** the handler unlinks `target_path` and responds `{ ok: true, value: { deleted: true } }`; the file no longer exists on disk

#### Scenario: Already-gone partial is treated as success

- **WHEN** a `downloads:delete-partial { downloadJobId }` arrives for a terminal row whose `target_path` no longer exists on disk (the `unlink` rejects with `ENOENT`)
- **THEN** the handler responds `{ ok: true, value: { deleted: true } }`; no error is surfaced

#### Scenario: Unknown downloadJobId is a no-op success

- **WHEN** a `downloads:delete-partial { downloadJobId }` arrives for a `downloadJobId` with no `downloads` row
- **THEN** the handler responds `{ ok: true, value: { deleted: false } }`; nothing is unlinked

#### Scenario: In-flight download is refused

- **WHEN** a `downloads:delete-partial { downloadJobId }` arrives for a row whose `status === 'in-flight'`
- **THEN** the handler unlinks nothing and responds with an error envelope (`ok: false`) whose `error` carries a message

#### Scenario: Completed download is refused (not a deletable partial)

- **WHEN** a `downloads:delete-partial { downloadJobId }` arrives for a row whose `status === 'completed'` (a full, successful download)
- **THEN** the handler unlinks nothing and responds with an error envelope (`ok: false`) whose `error` carries a message; the completed file is left intact

#### Scenario: Permission error surfaces as an error envelope

- **WHEN** the `unlink` of `target_path` rejects with `EACCES` / `EPERM`
- **THEN** the handler responds with an error envelope (`ok: false`) whose `error` carries the failure reason
