// `clearDownloadHistory` — the SQL core of the `downloads:clear-history`
// command (add-download-history-ui §4, design.md Decision 5).
//
// Deletes matching TERMINAL `downloads` rows by an optional filter:
//   - `status`   restricts to those terminal statuses (AND);
//   - `olderThanMs` restricts to rows whose `ended_at` is older than
//     `now - olderThanMs` (AND);
//   - no filter (or an absent member) imposes no restriction on that axis.
//
// The live `in-flight` row is NEVER deleted — the `status != 'in-flight'`
// guard leads every query, so even a hostile `status: ['in-flight']` filter
// (an empty intersection) or `olderThanMs: 0` leaves it intact.
// `Date.now()` is read internally; the age tests pin it with fake timers.
//
// add-leftover-download-cleanup §4 (contract change): BEFORE the DELETE, this
// unlinks the on-disk `target_path` of every KEEP-eligible terminal row
// (`failed`/`cancelled`/`interrupted`) in the computed delete set — clearing
// history also reclaims the leftover partial files it forgets. Completed
// rows' saved files are NEVER unlinked: the pre-delete SELECT restricts to the
// KEEP-eligible statuses with a LITERAL `status IN (...)`, so a completed row
// (or even a hostile `filter.status: ['completed']`) can never enter the
// unlink set, even though the row DELETE below still removes it. The unlink is
// best-effort — any error (ENOENT/EACCES/EPERM/…) is tolerated and never
// blocks the deletion nor alters the returned count (rows removed). This
// reverses the former "pure SQL, structurally cannot touch on-disk files"
// property; the filesystem `unlink` is injected (defaults to node's fs) so
// tests stay hermetic.

import { unlink as nodeUnlink } from "node:fs/promises";

import type Database from "better-sqlite3";

import type { DownloadTerminalStatus } from "@cloudstash/ipc-contracts/sync-service";

export interface ClearHistoryFilter {
  readonly status?: readonly DownloadTerminalStatus[];
  readonly olderThanMs?: number;
}

/** Minimal filesystem port — injected in tests, defaults to node's fs. */
export interface ClearHistoryFs {
  unlink(path: string): Promise<void>;
}

const defaultUnlinkFs: ClearHistoryFs = { unlink: (p) => nodeUnlink(p) };

/**
 * Deletes matching terminal download-history rows and unlinks the on-disk
 * partials of the KEEP-eligible subset (completed rows' files are never
 * touched); returns the count of rows removed. Async — the best-effort
 * unlinks run before the (synchronous better-sqlite3) DELETE.
 */
export async function clearDownloadHistory(
  db: Database.Database,
  filter?: ClearHistoryFilter,
  fs: ClearHistoryFs = defaultUnlinkFs,
): Promise<number> {
  const clauses: string[] = ["status != 'in-flight'"];
  const args: Array<string | number> = [];

  if (filter?.status !== undefined) {
    if (filter.status.length === 0) {
      // An explicit empty status set intersects nothing — delete nothing,
      // without emitting an invalid `status IN ()` clause.
      return 0;
    }
    const placeholders = filter.status.map(() => "?").join(", ");
    clauses.push(`status IN (${placeholders})`);
    args.push(...filter.status);
  }

  if (filter?.olderThanMs !== undefined) {
    clauses.push("ended_at < ?");
    args.push(Date.now() - filter.olderThanMs);
  }

  const where = clauses.join(" AND ");

  // Collect the KEEP-eligible subset of the delete set and unlink their
  // on-disk partials before the DELETE. The trailing `status IN (...)` is a
  // LITERAL — it is NOT derived from `filter.status` — so `completed` rows can
  // never appear here (that literal AND is the whole proof completed files are
  // never unlinked). Same `where`/`args` as the DELETE keeps the sets aligned,
  // including a single consistent age cutoff.
  const keepEligible = db
    .prepare(
      `SELECT target_path FROM downloads
        WHERE ${where}
          AND status IN ('failed', 'cancelled', 'interrupted')`,
    )
    .all(...args) as Array<{ target_path: string }>;

  // Best-effort: allSettled tolerates every unlink rejection so a missing /
  // permission-denied partial never blocks the row deletion nor throws.
  await Promise.allSettled(
    keepEligible.map((row) => fs.unlink(row.target_path)),
  );

  const result = db.prepare(`DELETE FROM downloads WHERE ${where}`).run(...args);
  return result.changes;
}
