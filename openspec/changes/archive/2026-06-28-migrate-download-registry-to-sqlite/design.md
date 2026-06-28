## Context

`add-engine-rename-download` shipped an in-memory `DownloadRegistry`
(`services/fs-sync/src/downloads/registry.ts`): a
`Map<downloadJobId, DownloadJobEntry>` plus a `byKey` reverse index. Each
entry carries a live `AbortController` (line 50) so the `sync:cancel-download`
handler can abort the in-flight stream
(`files-download.ts` → `entry.abortController.abort()`). The
`files:download` handler drives the registry: `set` on start,
`update(bytes/contentLength)` on every `onProgress` tick, and `delete` on
terminal success/failure/cancel (`files-download.ts:1602`, `:1620`).
`downloads:list-active` projects the registry snapshot to the wire
`DownloadJob` (dropping `abortController`) for reconnect hydration.

The fs-sync service already owns a SQLite database (`sync.db`) via
`better-sqlite3` with Drizzle ORM (`db/schema.ts`), forward-only raw-SQL
migrations under `drizzle/` tracked in `schema_migrations`
(`db/migrations.ts`), and an existing `recoverRunningJobs(db)` startup
reconciliation for the `jobs` table (`bootstrap.ts`). A single-instance
PID guard is acquired during bootstrap (the "Single-instance guard via
PID file" requirement) before the IPC listener opens.

Three gaps motivate this change: (1) no durability across service
restart, (2) no download history, (3) no foundation for service-crash
recovery. The scope decision (brainstorming, 2026-06-28) was to track the
**full** lifecycle — including crash-interrupted downloads — but to keep
this change focused on **durability only** and defer all *surfacing*
(retention policy, manual clear, UI) to the follow-up stub
`add-download-history-ui`.

## Goals / Non-Goals

**Goals:**

- Persist the full download lifecycle to a durable `downloads` SQLite
  table: in-flight rows, throttled progress, terminal outcomes, and
  crash-interrupted records.
- Keep the existing wire contract (`DownloadJob`, `downloads:list-active`)
  and the registry's synchronous call surface byte-for-byte unchanged for
  consumers.
- Provide the durable data that a future "recent downloads" UI, the
  retention controls in `add-download-history-ui`, and the stubbed
  `add-failed-download-cleanup-affordance` Phase 2 can read.

**Non-Goals:**

- **Retention policy / auto-prune, manual history clear, and any history
  UI.** Deferred to the follow-up stub `add-download-history-ui`. This
  change writes durable rows; it does not prune them, expose a clear
  command, or render them. Interim unbounded growth is acceptable
  (rows are tiny; the follow-up adds configurable retention before it
  matters).
- **Download replay / resume-on-restart.** Marking an interrupted row is
  bookkeeping, not replay. Resuming a partial after a service crash stays
  out of scope (it was explicitly excluded by `add-download-resilience` on
  the architectural-boundary argument).
- **Making SQLite the source of truth for live state.** The in-memory Map
  stays authoritative (see Decision 1).
- **Any IPC / renderer change.** Wire contract is unchanged.

## Decisions

### Decision 1 — Memory-authoritative, SQLite as a write-through mirror (NOT SQLite-authoritative)

The in-memory `Map` + `AbortController` side-state remains the source of
truth for live download state; SQLite is a durable mirror written through
the same registry methods. `downloads:list-active` keeps reading the
in-memory snapshot.

**Rationale.** The registry entry carries a live `AbortController`
(`registry.ts:50`) which is a per-process object and **cannot be
persisted**. So an in-memory structure must exist regardless. Given that,
making SQLite authoritative for the *active set* buys nothing: the only
consumers that durable live-state would serve are replay (out of scope)
and `list-active` reconnect-hydration (which reads memory, fresh and
fast). It would merely relocate the memory↔DB drift into the
abortController side-table and add a DB read on the hot `list-active`
path.

**Alternative considered — SQLite-authoritative (the stub's Q4 "SQLite-only
reads").** Rejected. It does not eliminate the in-memory abortController
side-table, so it loses the "single source of truth" purity it claims;
and its startup reconciliation must mutate in-flight rows, which is the
hazard Decision 5 has to defend against. Memory-authoritative is robust
to a stale mirror row (cosmetic, not corrupting).

### Decision 2 — DEVIATION from the stub's acceptance criteria

The stub's acceptance criteria say "the in-memory `Map` ... is deleted"
and "`downloads:list-active` reads from SQLite." This change **keeps** the
Map and keeps `list-active` reading from memory. This is a deliberate,
documented deviation forced by Decision 1 (non-persistable
`AbortController`; live-state durability unactionable without replay). The
stub's intent — "make the data durable" — is fully met; only the
mechanism differs.

### Decision 3 — The registry is the single writer to the `downloads` table

`createDownloadRegistry(db)` takes the `db` handle and owns all writes to
the `downloads` table. The `db` parameter is **optional** for the duration
of this transition: bootstrap always passes it (production is fully
mirrored), but the pre-existing in-memory-only test suites
(`files-download.test.ts`, `downloads-list-active.test.ts`,
`download-conflict.test.ts` — ~56 call-sites that exercise only the Map
contract) keep calling `createDownloadRegistry()` with no argument and stay
green untouched. With `db` omitted the registry is pure in-memory (no DB
access, no row writes); the SQLite mirror engages only when `db` is present.
This preserves the "single writer in production" intent while keeping the
edit blast-radius confined to `registry.ts` + its own test. Method →
persistence mapping:

| Method | In-memory | SQLite |
|---|---|---|
| `set(entry)` (start) | `Map.set` + reverse-index | `INSERT` row `status='in-flight'`, `bytes_downloaded=0`, `started_at`/`updated_at=now` |
| `update(id, partial)` (progress) | replace slot (existing behavior) | **throttled** `UPDATE bytes_downloaded/content_length/updated_at` (Decision 4) |
| `finalize(id, outcome)` (terminal) | `Map.delete` + reverse-index cleanup | force-flush final bytes + `UPDATE status/failure_tag/failure_message/ended_at/updated_at` |
| `get` / `snapshot` / `findByKey` / `size` | unchanged | no DB access |

`finalize(id, outcome)` **replaces** the current `delete(id)`. The
`outcome` carries the terminal status the handler already knows at each
terminal path: success → `completed` (`bytes_downloaded = bytesWritten`),
abort/cancel → `cancelled`, error → `failed` + normalized
`failure_tag` / `failure_message`. The `files-download.ts` terminal
call-sites (`registry.delete(downloadJobId)` at ~`:1602` and `:1620`)
become `registry.finalize(downloadJobId, { status, failureTag?, failureMessage?, bytesDownloaded? })`.

The registry stays **synchronous** (better-sqlite3 is synchronous), so no
consumer signature churns and the ~10 call-sites in `files-download.ts`
keep their shape.

**Alternative considered — a separate persistence layer subscribing to the
registry.** Rejected as needless indirection; the registry already owns
every lifecycle transition and is the natural single writer.

### Decision 4 — Progress writes are throttled to milestones (10 MB OR 30 s)

`update` writes to SQLite only when `bytes_downloaded` has advanced ≥ 10 MB
since the last flush OR ≥ 30 s of wall time has elapsed, whichever comes
first. A per-job throttle tracker (`lastFlushedBytes`, `lastFlushedAtMs`)
gates the write; the in-memory slot still updates on every tick.
`finalize` always force-flushes the final byte count regardless of the
throttle, then clears the tracker entry.

**Rationale.** A fast download fires `onProgress` hundreds of times per
second; unthrottled that is hundreds of DB writes/sec. The mirror only
needs to be approximately current — `list-active` reads memory (exact),
and the DB row is for history/hydration, where being off by ≤ 10 MB / 30 s
is immaterial. The final flush guarantees the terminal row is exact.

### Decision 5 — `sweepInterruptedDownloads(db)` runs after the PID guard

On startup the service runs
`UPDATE downloads SET status='interrupted', ended_at=now, updated_at=now WHERE status='in-flight'`.
Any `in-flight` row at startup is necessarily from a prior process (this
process has started no downloads yet), so this records crash/restart
interruptions as a terminal `interrupted` status. Modeled on the existing
`recoverRunningJobs(db)`.

The sweep MUST run **after** the single-instance PID guard is acquired
(bootstrap stage 4+), so only the process that won single-instance
enforcement ever sweeps. This closes the "a second starting instance
terminalizes the first's live in-flight rows" hazard **without** depending
on the unmerged `add-service-instance-lock` (that change governs desktop
*client* connections; the existing PID guard already prevents two service
*processes* sharing one data dir). Because the registry is
memory-authoritative (Decision 1), even a mistaken sweep would be cosmetic
(a live download keeps streaming; only its mirror row would read
`interrupted`), but ordering after the PID guard removes the possibility
entirely under the single-instance invariant.

### Decision 6 — Schema, migration, and version bump

New Drizzle table `downloads` in `db/schema.ts`; new forward-only
migration `drizzle/0002_downloads.sql` (auto-applied by `applyMigrations`
on next start, tracked in `schema_migrations`); `CURRENT_SCHEMA_VERSION`
1 → 2 in `db/migrations.ts`. A fresh install seeds
`service_meta.schema_version = 2`; an existing v1 DB keeps its
`schema_version` row but gains the `downloads` table via the migration
(forward-only migrations are filename-tracked, independent of the seeded
version value). The schema:

```sql
CREATE TABLE IF NOT EXISTS downloads (
  download_job_id  TEXT PRIMARY KEY,   -- matches the live registry's downloadJobId (the stub said transaction_id — a stale name)
  datasource_id    TEXT NOT NULL,
  source_path      TEXT NOT NULL,
  target_path      TEXT NOT NULL,
  bytes_downloaded INTEGER NOT NULL DEFAULT 0,
  content_length   INTEGER,            -- null until provider headers arrive
  status           TEXT NOT NULL CHECK (status IN
                     ('in-flight','completed','failed','cancelled','interrupted')),
  failure_tag      TEXT,
  failure_message  TEXT,
  started_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  ended_at         INTEGER             -- null while in-flight
);
CREATE INDEX IF NOT EXISTS downloads_status_idx     ON downloads (status);
CREATE INDEX IF NOT EXISTS downloads_started_at_idx ON downloads (started_at);
```

Apply must verify nothing asserts `service_meta.schema_version === 1`
beyond the fresh-init test (the "Fresh database is initialized" scenario
moves to `schemaVersion = 2` and the five-table set).

The `started_at` index is included now (it costs nothing here) to support
ordering history by start time — the consumer is the deferred history-list
view, not retention. Retention/clear filter on `ended_at` (and `status`,
which is indexed); on this tiny table a scan over `ended_at` is acceptable,
so no `ended_at` index is added here.

### Decision 7 — Wire contract unchanged

The five `status` values live only in the DB. `downloads:list-active`
returns only the in-memory in-flight set projected to the unchanged
`DownloadJob` (drops `abortController`). No `@ft5/ipc-contracts` change;
desktop main and renderer are untouched.

### Decision 8 — Concurrency: rely on the existing serialization

All registry writes run on the single Node thread through synchronous
better-sqlite3 calls, so writes are already serialized. Multi-event bursts
for one `downloadJobId` are further bounded by the Decision 4 throttle.
Wrapping multi-statement operations (e.g. `finalize`'s force-flush +
status update) in the existing better-sqlite3 transaction helper is
belt-and-suspenders, not load-bearing.

## Risks / Trade-offs

- **Mirror drift between memory and DB on the progress path** → Accepted by
  design (Decision 4); `list-active` reads memory (exact), the DB is
  history. `finalize` force-flush makes the terminal row exact.
- **Schema-version bump ripples into the fresh-init test / any
  `schema_version == 1` assertion** → Decision 6 + a verification task: the
  fresh-init scenario moves to `schemaVersion = 2`; grep for any other
  hard-coded `schema_version` assertion before bumping.
- **A second service instance wrongly sweeps live rows** → Mitigated by
  ordering the sweep after the PID guard (Decision 5); memory-authoritative
  design makes any residual case cosmetic, not corrupting.
- **History table grows without bound in the interim** → Accepted: no prune
  in this change (deferred to `add-download-history-ui`). Rows are tiny
  (hundreds of bytes); thousands of downloads stay sub-megabyte. The
  follow-up adds configurable retention well before this matters.
- **`Date.now()` in the throttle/sweep makes time-based tests fragile** →
  Inject a clock (or use `vi.useFakeTimers`) in tests for the throttle
  boundary and the sweep.

## Migration Plan

1. Add the Drizzle table + `0002_downloads.sql`; bump
   `CURRENT_SCHEMA_VERSION`. On next service start the migration applies
   forward-only and is recorded in `schema_migrations`.
2. Wire `createDownloadRegistry(db)`, the throttle, and `finalize`; switch
   the `files-download.ts` terminal call-sites.
3. Add `sweepInterruptedDownloads` (after PID guard) in bootstrap.
4. **Rollback:** the change is additive and forward-only. Reverting the
   code leaves an unused `downloads` table in any DB that already
   migrated; the table is inert (no reader outside this feature) and
   harmless. No data migration to undo.

## Open Questions

None — all five stub open questions were resolved during brainstorming
(2026-06-28): Q1 throttle = 10 MB / 30 s (Decision 4); Q2 retention =
**deferred** to `add-download-history-ui` (configurable auto-prune + manual
clear); Q3 = standard `0002` forward-only migration (Decision 6); Q4 =
memory-authoritative, rejecting SQLite-only reads (Decisions 1–2); Q5 =
rely on existing serialization, transaction wrapper belt-and-suspenders
(Decision 8).
