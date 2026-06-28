// `pruneDownloadHistory` — the retention prune deferred out of
// `migrate-download-registry-to-sqlite` and landed here by
// `add-download-history-ui` (design.md Decision 4).
//
// Deletes every TERMINAL `downloads` row (`status != 'in-flight'`) whose
// `ended_at` is older than `now - maxAgeMs`. It NEVER deletes the live
// `in-flight` row (the `WHERE` excludes it, and an in-flight row's `ended_at`
// is NULL so the age comparison would skip it regardless). Being pure SQL over
// the `downloads` table, it structurally cannot touch partial files on disk —
// bookkeeping only, consistent with the startup sweep.
//
// `Date.now()` is read internally (mirroring `sweepInterruptedDownloads`); the
// window-boundary tests pin it with `vi.useFakeTimers()` / `vi.setSystemTime`.
// The `downloads` table + its `status`/`ended_at` columns are owned by
// `migrate-download-registry-to-sqlite`.

import type Database from "better-sqlite3";

export interface PruneOptions {
  /** Rows whose `ended_at` is older than `now - maxAgeMs` are deleted. */
  readonly maxAgeMs: number;
}

/**
 * Deletes aged terminal download-history rows. Returns the number of rows
 * removed. Synchronous (better-sqlite3) — the single DELETE runs on the one
 * Node thread with no interleaving.
 */
export function pruneDownloadHistory(
  db: Database.Database,
  options: PruneOptions,
): number {
  const cutoff = Date.now() - options.maxAgeMs;
  const result = db
    .prepare(
      `DELETE FROM downloads
        WHERE status != 'in-flight' AND ended_at < ?`,
    )
    .run(cutoff);
  return result.changes;
}
