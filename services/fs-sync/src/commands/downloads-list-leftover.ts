// `downloads:list-leftover` command handler
// (add-leftover-download-cleanup §3). Projects every KEEP-eligible terminal
// `downloads` row (`failed` / `cancelled` / `interrupted`) whose recorded
// `target_path` STILL exists on disk to a `LeftoverEntry` — the
// retention-bounded failure subset further narrowed to files still present.
// The renderer has no filesystem access, so on-disk existence and current
// size are determined service-side via an injected `stat` port.
//
// The handler is READ-ONLY: it never resolves an engine client, never unlinks
// anything, and NEVER throws. A `stat` that rejects — ENOENT (file gone) OR
// any other error (e.g. EACCES) — means "not a live leftover", so that row is
// silently skipped. This differs from `downloads:delete-partial`, which
// surfaces a non-ENOENT unlink error as an error envelope; a list stat error
// is a skip, never a failure. `completed` / `in-flight` rows are excluded
// entirely (a completed row's `target_path` is the full download, not a
// partial). Entries are ordered by `ended_at` descending (most recently ended
// first) and the response is NOT paginated.
//
// See:
// - openspec/changes/add-leftover-download-cleanup/specs/fs-sync-service/spec.md
//   "Requirement: `downloads:list-leftover` RPC returns KEEP-eligible rows
//   with an on-disk partial" + its scenarios.

import { stat as nodeStat } from "node:fs/promises";

import type Database from "better-sqlite3";

import type { LeftoverEntry } from "@cloudstash/ipc-contracts/sync-service";

import type { CommandHandler } from "../ipc/server.js";

/**
 * Minimal filesystem port — injected in tests, defaults to node's fs. Only
 * `size` is read from the returned stats; `node:fs/promises` `stat` is called
 * WITHOUT the bigint option so `size` is a plain `number`.
 */
export interface ListLeftoverFs {
  stat(path: string): Promise<{ size: number }>;
}

export interface ListLeftoverDeps {
  readonly db: Database.Database;
  /** Defaults to `node:fs/promises` stat; overridable for tests. */
  readonly fs?: ListLeftoverFs;
}

interface LeftoverRow {
  readonly download_job_id: string;
  readonly datasource_id: string;
  readonly source_path: string;
  readonly target_path: string;
  readonly failure_tag: string | null;
  readonly failure_message: string | null;
  readonly ended_at: number | null;
}

export function makeListLeftoverHandler(
  deps: ListLeftoverDeps,
): CommandHandler<"downloads:list-leftover"> {
  const fs: ListLeftoverFs = deps.fs ?? { stat: (p) => nodeStat(p) };
  const select = deps.db.prepare(
    `SELECT download_job_id, datasource_id, source_path, target_path,
            failure_tag, failure_message, ended_at
       FROM downloads
      WHERE status IN ('failed', 'cancelled', 'interrupted')
      ORDER BY ended_at DESC`,
  );

  return async () => {
    const rows = select.all() as LeftoverRow[];
    const entries: LeftoverEntry[] = [];

    for (const row of rows) {
      let size: number;
      try {
        size = (await fs.stat(row.target_path)).size;
      } catch {
        // Any stat rejection (ENOENT or otherwise) means the partial is gone
        // / not readable — not a live leftover. Skip it; never throw.
        continue;
      }
      entries.push({
        downloadJobId: row.download_job_id,
        datasourceId: row.datasource_id,
        sourcePath: row.source_path,
        targetPath: row.target_path,
        sizeOnDisk: size,
        failureTag: row.failure_tag,
        failureMessage: row.failure_message,
        endedAt: row.ended_at,
      });
    }

    return { ok: true, result: { entries } };
  };
}
