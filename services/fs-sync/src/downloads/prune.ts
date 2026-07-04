// `pruneDownloadHistory` — the retention prune deferred out of
// `migrate-download-registry-to-sqlite` and landed here by
// `add-download-history-ui` (design.md Decision 4).
//
// Deletes aged TERMINAL `downloads` rows (`status != 'in-flight'` whose
// `ended_at` is older than `now - maxAgeMs`), with ONE carve-out added by
// `add-leftover-download-cleanup` §5 (contract change): a KEEP-eligible
// terminal row (`failed` / `cancelled` / `interrupted`) whose recorded
// `target_path` STILL exists on disk is RETAINED past its retention window, so
// it stays discoverable via `downloads:list-leftover`; it is pruned on a later
// cycle once the file is gone. Completed aged rows, and KEEP-eligible aged rows
// whose file is already gone, are still deleted. The live `in-flight` row is
// never deleted (the `WHERE` excludes it, and its NULL `ended_at` fails the age
// comparison regardless).
//
// On-disk existence is probed through an injected `stat` port (defaults to
// `node:fs/promises`). A per-row `stat` rejection — ENOENT (file gone) OR any
// other error (e.g. EACCES) — degrades to "file gone" so the row is eligible
// for deletion; a single bad stat NEVER aborts the run. The prune NEVER unlinks
// anything — the headless retention path removes records only, consistent with
// the startup sweep. Only file EXISTENCE decides retention; the reported `size`
// is unused here (the port shape is shared with `downloads:list-leftover`).
//
// `Date.now()` is read internally (mirroring `sweepInterruptedDownloads`); the
// window-boundary tests pin it with `vi.useFakeTimers()` / `vi.setSystemTime`.
// The `downloads` table + its `status`/`ended_at`/`target_path` columns are
// owned by `migrate-download-registry-to-sqlite`.

import { stat as nodeStat } from "node:fs/promises";

import type Database from "better-sqlite3";

export interface PruneOptions {
  /** Rows whose `ended_at` is older than `now - maxAgeMs` are deleted. */
  readonly maxAgeMs: number;
}

/**
 * Minimal filesystem port — injected in tests, defaults to node's fs. Only
 * file EXISTENCE matters (a resolved `stat` = retain); `size` is unused but
 * kept so the port shape matches `downloads:list-leftover`'s `ListLeftoverFs`.
 * `node:fs/promises` `stat` is called WITHOUT the bigint option so `size` is a
 * plain `number`.
 */
export interface PruneFs {
  stat(path: string): Promise<{ size: number }>;
}

const defaultStatFs: PruneFs = { stat: (p) => nodeStat(p) };

interface KeepEligibleRow {
  readonly download_job_id: string;
  readonly target_path: string;
}

/**
 * Deletes aged terminal download-history rows, retaining any KEEP-eligible
 * aged row whose on-disk partial still exists (kept discoverable via
 * `downloads:list-leftover`). Returns the number of rows removed. Async —
 * probes each KEEP-eligible aged row's `target_path` through the `stat` port
 * before the (synchronous better-sqlite3) DELETE. Never unlinks any file.
 */
export async function pruneDownloadHistory(
  db: Database.Database,
  options: PruneOptions,
  fs: PruneFs = defaultStatFs,
): Promise<number> {
  const cutoff = Date.now() - options.maxAgeMs;

  // The KEEP-eligible aged rows are the only candidates for retention — a
  // completed row is never eligible, so its disk state is never consulted.
  const keepEligible = db
    .prepare(
      `SELECT download_job_id, target_path
         FROM downloads
        WHERE status IN ('failed', 'cancelled', 'interrupted')
          AND ended_at < ?`,
    )
    .all(cutoff) as KeepEligibleRow[];

  // Retain a row iff its partial is still on disk. A stat rejection (ENOENT or
  // any other error) degrades to "gone" — the row stays eligible for deletion
  // and the run continues (a single bad stat never aborts the cycle).
  const retainedIds: string[] = [];
  for (const row of keepEligible) {
    try {
      await fs.stat(row.target_path);
      retainedIds.push(row.download_job_id);
    } catch {
      // File gone / unreadable → not a live leftover → prunable.
    }
  }

  // Delete aged terminal rows EXCEPT the retained ones. `NOT IN ()` is invalid
  // SQL, so the exclusion clause is omitted entirely when nothing is retained.
  if (retainedIds.length === 0) {
    const result = db
      .prepare(
        `DELETE FROM downloads
          WHERE status != 'in-flight' AND ended_at < ?`,
      )
      .run(cutoff);
    return result.changes;
  }

  const placeholders = retainedIds.map(() => "?").join(", ");
  const result = db
    .prepare(
      `DELETE FROM downloads
        WHERE status != 'in-flight' AND ended_at < ?
          AND download_job_id NOT IN (${placeholders})`,
    )
    .run(cutoff, ...retainedIds);
  return result.changes;
}
