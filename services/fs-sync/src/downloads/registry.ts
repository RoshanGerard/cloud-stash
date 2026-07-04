// `DownloadRegistry` for the fs-sync service. Holds the DOWNLOAD-side state:
// a `Map<downloadJobId, DownloadJobEntry>` of in-flight downloads (the
// authoritative live state), AND — when constructed with a `db` handle —
// write-through-mirrors the download lifecycle into the durable `downloads`
// SQLite table. Exposed via the `downloads:list-active` RPC (§14) and
// consumed by the `files:download` handler (§13).
//
// See:
// - openspec/changes/add-engine-rename-download/design.md "Decision 4"
//   (originally in-memory only; disk persistence was deferred to follow-up
//   `migrate-download-registry-to-sqlite`).
// - openspec/changes/migrate-download-registry-to-sqlite/design.md
//   "Decision 1/3/4/6" (memory-authoritative + SQLite write-through mirror;
//   the registry is the single writer to `downloads`; throttled progress
//   writes; `finalize` is the sole terminal-status writer).
// - openspec/changes/add-engine-rename-download/specs/fs-sync-service/spec.md
//   "Requirement: In-memory `DownloadRegistry` tracks active downloads".
//
// Durable mirror (migrate-download-registry-to-sqlite). The `db` parameter
// is OPTIONAL for the duration of this transition: bootstrap always passes
// it (production is fully mirrored), but the pre-existing in-memory-only test
// suites keep calling `createDownloadRegistry()` with no argument and stay
// green untouched. With `db` omitted the registry is pure in-memory (no DB
// access). With `db` present:
//   - `set`    → INSERT OR REPLACE an `in-flight` row (resets on re-`set`).
//   - `update` → THROTTLED UPDATE of bytes/content_length (10 MB OR 30 s).
//   - `finalize` → FORCED UPDATE of the terminal status + final bytes +
//                  failure metadata + `ended_at`, then memory cleanup. The
//                  only terminal-status writer and the only memory-removal
//                  path (the §13 handler finalizes on every terminal path).
//
// Naming note. The IPC-exposed `DownloadJob` from `@cloudstash/ipc-contracts`
// (sync-service/commands.ts) is the wire shape — `downloadJobId`,
// `datasourceId`, `sourcePath`, `targetPath`, `bytesDownloaded`,
// `contentLength`, `startedAt`, no `abortController`. This service-internal
// shape carries the `AbortController` so the handler can drive cancels
// through it; we name it `DownloadJobEntry` to avoid a collision when the
// §14 list-active handler imports both types and projects between them.
//
// Concurrency. JavaScript is single-threaded, so map mutations are atomic
// at the call boundary. The "concurrent updates do not lose data" property
// just means this API does not read-modify-write across awaits in a way
// that races. All methods are synchronous; `update` uses spread-replace
// (fresh object per call) so a snapshot taken before an update is
// unaffected by the update.

/**
 * One in-flight download tracked by the service. Identity fields
 * (`downloadJobId`, `datasourceId`, `sourcePath`, `targetPath`, `startedAt`)
 * and the `abortController` are immutable for the entry's lifetime — only
 * `bytesDownloaded` and `contentLength` mutate as the engine streams
 * bytes. The `update` API enforces this at the type level via
 * `DownloadJobUpdate`.
 *
 * Mirrors the IPC-exposed `DownloadJob` from `@cloudstash/ipc-contracts`
 * (sync-service/commands.ts) plus an `abortController` field. Field
 * `readonly` markers match the IPC type so projecting one to the other in
 * §14 is a structural drop-the-controller.
 */
export interface DownloadJobEntry {
  readonly downloadJobId: string;
  readonly datasourceId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly bytesDownloaded: number;
  readonly contentLength: number | null;
  readonly startedAt: number; // ms epoch
  readonly abortController: AbortController;
}

/**
 * Partial accepted by `DownloadRegistry.update` — narrows to the two
 * fields the engine's streaming bytes legitimately mutate. Identity
 * fields and the abort controller are unrepresentable in this type so
 * the compiler rejects an attempt to reassign them.
 */
export type DownloadJobUpdate = Partial<
  Pick<DownloadJobEntry, "bytesDownloaded" | "contentLength">
>;

/**
 * Terminal outcome handed to `DownloadRegistry.finalize`. `status` is the
 * terminal state the handler already knows at each terminal path:
 *   - success → `completed`
 *   - abort / cancel → `cancelled`
 *   - error → `failed` (+ normalized `failureTag` / `failureMessage`)
 *
 * `'interrupted'` is NOT a finalize outcome — it is a recovery-time status
 * assigned to rows left `in-flight` by a crash, not something the live
 * registry transitions to.
 *
 * `bytesDownloaded`, when present, is the authoritative final byte count
 * force-written to the row (ignoring the progress throttle). When omitted,
 * `finalize` falls back to the current in-memory entry's `bytesDownloaded`
 * (or `0` if the entry is already gone).
 */
export interface DownloadFinalizeOutcome {
  readonly status: "completed" | "failed" | "cancelled";
  readonly failureTag?: string;
  readonly failureMessage?: string;
  readonly bytesDownloaded?: number;
}

export interface DownloadRegistry {
  /**
   * Adds an entry keyed by `entry.downloadJobId`. If an entry with the same
   * id already exists, it is replaced (last-writer-wins). The handler
   * mints a fresh `downloadJobId` per `files:download` invocation so a
   * collision indicates a programming error upstream — we tolerate it
   * silently rather than throw, to keep the registry contract as
   * forgiving as `Map.set`.
   */
  set(entry: DownloadJobEntry): void;

  /**
   * Returns the live entry, or `undefined` if no entry with that
   * `downloadJobId` exists. The returned object is the one stored in the
   * registry; callers must not mutate it. (`update` replaces the slot
   * with a fresh object, so mutating a returned reference does NOT
   * propagate to subsequent gets / snapshots — but it would tear
   * concurrent readers, so don't.)
   */
  get(downloadJobId: string): DownloadJobEntry | undefined;

  /**
   * Merges `partial` into the existing entry. No-op (and no throw) if
   * `downloadJobId` is unknown — this matches the engine-bus
   * subscription's reality: a `downloading` event for a job whose
   * registry entry was already removed by a terminal event is a benign
   * race we want to swallow.
   *
   * Implementation uses `set(id, { ...prev, ...partial })` so a snapshot
   * taken before the update keeps its pre-update values.
   */
  update(downloadJobId: string, partial: DownloadJobUpdate): void;

  /**
   * Terminal transition: force-writes the terminal `status`, final
   * `bytes_downloaded`, failure metadata, and `ended_at`/`updated_at` to the
   * `downloads` row (ignoring the progress throttle), THEN removes the
   * in-memory entry + reverse-index + throttle-tracker state.
   *
   * No-op (and no throw) if `downloadJobId` is unknown — 0 rows touched, no
   * memory change. (Mirrors `update`: a terminal call for a job whose entry
   * was already removed is a benign race — finalizing twice writes nothing
   * the second time, so every terminal path may finalize freely.)
   *
   * When `db` was not supplied at construction this is a memory-only
   * removal.
   */
  finalize(downloadJobId: string, outcome: DownloadFinalizeOutcome): void;

  /**
   * Returns a stable copy of the current entries ordered by `startedAt`
   * ascending (oldest first). The returned array is fresh per call;
   * mutating it (push, splice, etc.) does not mutate the registry.
   * Entry references are shared with the registry, but entries are
   * `readonly` and `update` replaces (not mutates) the slot, so
   * snapshot consumers see a consistent point-in-time view.
   *
   * Used by the `downloads:list-active` handler (§14) to project to the
   * IPC-exposed `DownloadJob[]` shape (drops `abortController`).
   */
  snapshot(): DownloadJobEntry[];

  /**
   * Reverse-index lookup (per add-engine-rename-download §13.23). Returns
   * the `downloadJobId` for the in-flight `(datasourceId, sourcePath)`
   * pair, or `undefined` if no entry exists for that key. O(1) — backed
   * by a Map keyed on `${datasourceId}::${sourcePath}` updated in lockstep
   * with `set` / `finalize`.
   *
   * Identity fields (`datasourceId`, `sourcePath`) are immutable across an
   * entry's lifetime per the §11 design, so the reverse-index does not
   * track `update` mutations — only insertions and removals.
   *
   * Used by:
   * - The `files:download` handler's concurrent-rejection guard (rejects
   *   a second download for the same `(datasourceId, sourcePath)` BEFORE
   *   any engine call is issued, per spec.md scenario "Concurrent
   *   download for the same `(datasourceId, path)` is rejected").
   * - The handler's engine-bus subscription callback to correlate
   *   engine `(datasourceId, path)` events back to the in-flight job's
   *   `downloadJobId` (per spec.md "Service subscribes to engine bus
   *   events for download lifecycle").
   */
  findByKey(datasourceId: string, sourcePath: string): string | undefined;

  /** Number of entries currently in the registry. */
  size(): number;
}

// Progress-throttle milestones (Decision 4). `update` flushes a progress
// write to the `downloads` row only when bytes have advanced ≥ 10 MB since
// the last flush OR ≥ 30 s have elapsed. Keeps the row roughly current for
// crash recovery without one disk write per byte tick.
const FLUSH_BYTES_THRESHOLD = 10 * 1024 * 1024; // 10 MB
const FLUSH_INTERVAL_MS = 30_000; // 30 s

/** Per-job throttle state. Seeded on `set`, reset on each flush, cleared on
 * `finalize`. Lives ONLY in this closure — never persisted. */
interface ThrottleState {
  lastFlushedBytes: number;
  lastFlushedAtMs: number;
}

export function createDownloadRegistry(
  db?: import("better-sqlite3").Database,
): DownloadRegistry {
  const entries = new Map<string, DownloadJobEntry>();
  // Reverse index keyed `${datasourceId}::${sourcePath}` → downloadJobId.
  // Updated in lockstep with `set` / `finalize`. NOT touched by `update`
  // because identity fields are immutable per the entry contract.
  const byKey = new Map<string, string>();
  // Per-job progress-throttle trackers. Present only while a job is live.
  const throttle = new Map<string, ThrottleState>();
  const keyOf = (datasourceId: string, sourcePath: string): string =>
    `${datasourceId}::${sourcePath}`;

  // Prepared statements — created once when `db` is supplied (policy-store
  // pattern). When `db` is omitted (in-memory-only construction) these stay
  // undefined and every DB branch below is skipped.
  const insertStmt = db?.prepare(
    `INSERT OR REPLACE INTO downloads (
       download_job_id, datasource_id, source_path, target_path,
       bytes_downloaded, content_length, status, failure_tag,
       failure_message, started_at, updated_at, ended_at
     ) VALUES (
       @downloadJobId, @datasourceId, @sourcePath, @targetPath,
       0, @contentLength, 'in-flight', NULL,
       NULL, @startedAt, @startedAt, NULL
     )`,
  );
  const progressStmt = db?.prepare(
    `UPDATE downloads
        SET bytes_downloaded = @bytesDownloaded,
            content_length = @contentLength,
            updated_at = @updatedAt
      WHERE download_job_id = @downloadJobId`,
  );
  const finalizeStmt = db?.prepare(
    `UPDATE downloads
        SET bytes_downloaded = @bytesDownloaded,
            status = @status,
            failure_tag = @failureTag,
            failure_message = @failureMessage,
            ended_at = @endedAt,
            updated_at = @updatedAt
      WHERE download_job_id = @downloadJobId`,
  );

  function set(entry: DownloadJobEntry): void {
    // If the slot is being replaced (last-writer-wins) AND the prior entry
    // had a different `(datasourceId, sourcePath)`, drop the old reverse
    // mapping. In practice this never fires because the handler mints a
    // fresh `downloadJobId` per call; the defensive sweep just keeps the
    // index honest if a caller violates the contract.
    const prev = entries.get(entry.downloadJobId);
    if (prev !== undefined) {
      const prevKey = keyOf(prev.datasourceId, prev.sourcePath);
      if (byKey.get(prevKey) === entry.downloadJobId) {
        byKey.delete(prevKey);
      }
    }
    entries.set(entry.downloadJobId, entry);
    byKey.set(keyOf(entry.datasourceId, entry.sourcePath), entry.downloadJobId);

    // Seed the throttle tracker. Seed `lastFlushedAtMs` from the SAME clock
    // `update` reads (`Date.now()`), NOT `entry.startedAt` — `startedAt` is a
    // caller-supplied timestamp that can be arbitrarily old, which would make
    // the first progress tick spuriously cross the 30 s time threshold.
    throttle.set(entry.downloadJobId, {
      lastFlushedBytes: 0,
      lastFlushedAtMs: Date.now(),
    });

    // SQLite write-through: insert (or reset) the row to a clean in-flight
    // state. INSERT OR REPLACE so a re-`set` of the same id wipes any stale
    // terminal/failure metadata (last-writer-wins, mirrors the Map).
    insertStmt?.run({
      downloadJobId: entry.downloadJobId,
      datasourceId: entry.datasourceId,
      sourcePath: entry.sourcePath,
      targetPath: entry.targetPath,
      contentLength: entry.contentLength,
      startedAt: entry.startedAt,
    });
  }

  function get(downloadJobId: string): DownloadJobEntry | undefined {
    return entries.get(downloadJobId);
  }

  function update(downloadJobId: string, partial: DownloadJobUpdate): void {
    const prev = entries.get(downloadJobId);
    if (prev === undefined) return; // pure no-op — never touches the db
    // Replace, don't mutate — keeps snapshot stability and avoids any
    // shared-reference tear with concurrent readers. The abortController
    // is carried by reference (do NOT clone — the handler aborts cancels
    // through this exact instance). Identity fields are typed-locked out
    // of `DownloadJobUpdate` so the reverse-index never needs touching.
    const next = { ...prev, ...partial };
    entries.set(downloadJobId, next);

    // Throttled SQLite progress write (Decision 4). Memory always updates
    // (above); the DB row flushes only at a 10 MB OR 30 s milestone.
    if (progressStmt === undefined) return;
    const tracker = throttle.get(downloadJobId);
    if (tracker === undefined) return; // defensive — set always seeds it
    const now = Date.now();
    const bytesDelta = next.bytesDownloaded - tracker.lastFlushedBytes;
    const shouldFlush =
      bytesDelta >= FLUSH_BYTES_THRESHOLD ||
      now - tracker.lastFlushedAtMs >= FLUSH_INTERVAL_MS;
    if (!shouldFlush) return;
    // Write both columns from the POST-merge entry (`next`), not from
    // `partial` — a contentLength-only update must not clobber bytes.
    progressStmt.run({
      downloadJobId,
      bytesDownloaded: next.bytesDownloaded,
      contentLength: next.contentLength,
      updatedAt: now,
    });
    tracker.lastFlushedBytes = next.bytesDownloaded;
    tracker.lastFlushedAtMs = now;
  }

  function finalize(
    downloadJobId: string,
    outcome: DownloadFinalizeOutcome,
  ): void {
    const prev = entries.get(downloadJobId);
    if (prev === undefined) return; // unknown id — 0 rows, no memory change

    // FORCED terminal write (ignores the progress throttle). Final bytes:
    // explicit outcome value wins; else current in-memory bytes; else 0.
    const now = Date.now();
    finalizeStmt?.run({
      downloadJobId,
      bytesDownloaded: outcome.bytesDownloaded ?? prev.bytesDownloaded ?? 0,
      status: outcome.status,
      failureTag: outcome.failureTag ?? null,
      failureMessage: outcome.failureMessage ?? null,
      endedAt: now,
      updatedAt: now,
    });

    // Memory cleanup — removes the entry + reverse-index + throttle tracker.
    entries.delete(downloadJobId);
    throttle.delete(downloadJobId);
    const prevKey = keyOf(prev.datasourceId, prev.sourcePath);
    if (byKey.get(prevKey) === downloadJobId) {
      byKey.delete(prevKey);
    }
  }

  function snapshot(): DownloadJobEntry[] {
    return Array.from(entries.values()).sort(
      (a, b) => a.startedAt - b.startedAt,
    );
  }

  function findByKey(
    datasourceId: string,
    sourcePath: string,
  ): string | undefined {
    return byKey.get(keyOf(datasourceId, sourcePath));
  }

  function size(): number {
    return entries.size;
  }

  return {
    set,
    get,
    update,
    finalize,
    snapshot,
    findByKey,
    size,
  };
}
