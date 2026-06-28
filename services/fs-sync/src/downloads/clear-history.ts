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
// (an empty intersection) or `olderThanMs: 0` leaves it intact. Being pure SQL
// over the `downloads` table, this structurally cannot touch on-disk files.
// `Date.now()` is read internally; the age tests pin it with fake timers.

import type Database from "better-sqlite3";

import type { DownloadTerminalStatus } from "@ft5/ipc-contracts/sync-service";

export interface ClearHistoryFilter {
  readonly status?: readonly DownloadTerminalStatus[];
  readonly olderThanMs?: number;
}

/**
 * Deletes matching terminal download-history rows; returns the count removed.
 * Synchronous (better-sqlite3).
 */
export function clearDownloadHistory(
  db: Database.Database,
  filter?: ClearHistoryFilter,
): number {
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

  const result = db
    .prepare(`DELETE FROM downloads WHERE ${clauses.join(" AND ")}`)
    .run(...args);
  return result.changes;
}
