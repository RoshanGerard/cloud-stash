# Proposal: Migrate the fs-sync download registry from in-memory to SQLite

> Promoted from a stub (spawned during `add-engine-rename-download`
> brainstorming on 2026-04-27). Open questions resolved in a
> brainstorming session on 2026-06-28; decisions captured in `design.md`.

## Why

The fs-sync `DownloadRegistry` is purely in-memory
(`Map<downloadJobId, DownloadJobEntry>`), so every completed, failed, or
cancelled download vanishes the instant it terminates, and any download
in flight when the service stops leaves no trace. There is no download
**history** to surface ("your last N downloads"), and a download
interrupted by a service crash/restart leaves an orphaned partial file
on disk with no record that it was ever happening. This change makes the
registry durable so the data exists for history, telemetry, and the
already-stubbed cleanup affordance.

## What Changes

- Add a `downloads` table to `sync.db` (new forward-only migration
  `services/fs-sync/drizzle/0002_downloads.sql` + a Drizzle table in
  `services/fs-sync/src/db/schema.ts`; bump `CURRENT_SCHEMA_VERSION`
  1 -> 2). The table records the full download lifecycle with a `status`
  of `in-flight | completed | failed | cancelled | interrupted`.
- Make the `DownloadRegistry` a **write-through mirror**: it stays
  in-memory and **synchronous** (it remains the source of truth for live
  state and for `downloads:list-active`), but now also writes through to
  the `downloads` table — `INSERT` on start, a throttled `UPDATE` on
  progress (every 10 MB OR 30 s), and a terminal-status `UPDATE` on
  completion/failure/cancellation. The registry's constructor takes the
  `db` handle (`createDownloadRegistry(db)`).
- Replace the registry's `delete(id)` with `finalize(id, outcome)`: the
  in-memory entry is still removed, but the `downloads` row is **retained**
  with its terminal status, byte count, and (on failure) error tag/message.
- Sweep crash-interrupted downloads on startup: any row left `in-flight`
  by a prior process is marked `interrupted`. The sweep runs **after** the
  existing single-instance PID guard is acquired, so only the winning
  service process touches the rows.
- **No wire-contract change.** The five `status` values live only in the
  DB. `downloads:list-active` still returns only the in-memory in-flight
  set projected to the unchanged `DownloadJob` shape.

This change stops at **durability**. Retention policy (configurable
auto-prune), manual history clear, and any UI to view/manage history are
deliberately deferred to the follow-up stub `add-download-history-ui`
("this change makes the data durable; surfacing it is a separate
follow-up"). Download-history rows are tiny (hundreds of bytes), so
interim unbounded growth is a non-issue until that follow-up ships.

This is **not** a breaking change. It deliberately deviates from the
stub's original acceptance criteria ("the in-memory `Map` is deleted",
"`list-active` reads from SQLite") — see `design.md` for the rationale
(the live `AbortController` is non-persistable, and live-state durability
is unactionable without replay, which is out of scope).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `fs-sync-service`: the `DownloadRegistry` requirement changes from
  "in-memory, SHALL NOT persist to disk" to "in-memory write-through
  mirror backed by a durable `downloads` table"; the SQLite-schema
  requirement gains the `downloads` table; the
  registry-transition-driving requirement changes terminal removal to a
  terminal-status `finalize`; and one new requirement covers the startup
  interrupted-sweep. No wire-contract (IPC command surface) change.

## Impact

- **Code (service-internal only):**
  - `services/fs-sync/src/db/schema.ts` — new `downloads` Drizzle table.
  - `services/fs-sync/drizzle/0002_downloads.sql` — new migration.
  - `services/fs-sync/src/db/migrations.ts` — `CURRENT_SCHEMA_VERSION`
    1 -> 2.
  - `services/fs-sync/src/downloads/registry.ts` — `createDownloadRegistry`
    takes `db`; `update` gains the milestone throttle; `delete` -> `finalize`.
  - `services/fs-sync/src/downloads/` — new `sweepInterruptedDownloads`
    function.
  - `services/fs-sync/src/commands/files-download.ts` — terminal
    `registry.delete(...)` call-sites switch to `registry.finalize(...)`
    with the known outcome.
  - `services/fs-sync/src/main/bootstrap.ts` — pass `db` into the
    registry; run the sweep after the PID guard.
- **Wire / IPC contract:** unchanged. No `@ft5/ipc-contracts` change; the
  desktop main and renderer are untouched.
- **Data:** new `downloads` table only; no migration of existing data
  (the in-memory registry was transient). Existing v1 databases gain the
  table on next start via the forward-only migration.
- **Follow-up:** `add-download-history-ui` (stub) owns retention
  (configurable auto-prune), manual clear (`downloads:clear-history`),
  and the renderer history/settings UI.
