// Tests for `pruneDownloadHistory` (add-download-history-ui §3.1, design.md
// Decision 4; contract change in add-leftover-download-cleanup §5). The prune
// deletes terminal `downloads` rows older than the window, with one carve-out:
// a KEEP-eligible terminal row (`failed`/`cancelled`/`interrupted`) whose
// recorded `target_path` STILL exists on disk is RETAINED past its retention
// window so it stays discoverable via `downloads:list-leftover`. Completed aged
// rows, and KEEP-eligible aged rows whose file is gone, are still deleted. It
// NEVER deletes the live `in-flight` row and NEVER unlinks any on-disk file —
// on-disk existence is probed through an injected `stat` port. The `downloads`
// table + its `status`/`ended_at` columns are owned by
// `migrate-download-registry-to-sqlite`.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyMigrations } from "../../db/migrations.js";
import { pruneDownloadHistory, type PruneFs } from "../prune.js";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed epoch for deterministic boundaries

function seed(
  db: Database.Database,
  id: string,
  status: string,
  endedAt: number | null,
  targetPath = "/b",
): void {
  db.prepare(
    `INSERT INTO downloads (
       download_job_id, datasource_id, source_path, target_path,
       bytes_downloaded, content_length, status, failure_tag,
       failure_message, started_at, updated_at, ended_at
     ) VALUES (
       @id, 'ds-1', '/a', @targetPath, 100, NULL, @status, NULL, NULL, 0, 0, @endedAt
     )`,
  ).run({ id, status, endedAt, targetPath });
}

function ids(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT download_job_id FROM downloads ORDER BY download_job_id`)
      .all() as Array<{ download_job_id: string }>
  ).map((r) => r.download_job_id);
}

/**
 * A hermetic `stat` port whose only on-disk files are the keys of `present`
 * (value = reported byte size). Any other path rejects with a synthetic
 * ENOENT — mirroring a partial that has already been removed. The port exposes
 * ONLY `stat` (never `unlink`), which is itself the proof the prune cannot
 * touch files.
 */
function statFs(present: Record<string, number>): PruneFs {
  return {
    stat: vi.fn(async (p: string) => {
      if (Object.prototype.hasOwnProperty.call(present, p)) {
        return { size: present[p]! };
      }
      const err = new Error(
        `ENOENT: no such file, stat '${p}'`,
      ) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }),
  };
}

describe("pruneDownloadHistory", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it("deletes terminal rows older than maxAgeMs; keeps newer; never in-flight", async () => {
    seed(db, "old-completed", "completed", NOW - 91 * DAY);
    seed(db, "new-failed", "failed", NOW - 10 * DAY);
    seed(db, "old-cancelled", "cancelled", NOW - 200 * DAY);
    seed(db, "live", "in-flight", null);

    const deleted = await pruneDownloadHistory(
      db,
      { maxAgeMs: 90 * DAY },
      statFs({}),
    );

    expect(deleted).toBe(2);
    expect(ids(db)).toEqual(["live", "new-failed"]);
  });

  it("age boundary is strict — a row exactly at the cutoff is kept", async () => {
    seed(db, "exactly-at-cutoff", "completed", NOW - 90 * DAY);
    seed(db, "just-older", "completed", NOW - 90 * DAY - 1);

    const deleted = await pruneDownloadHistory(
      db,
      { maxAgeMs: 90 * DAY },
      statFs({}),
    );

    expect(deleted).toBe(1);
    expect(ids(db)).toEqual(["exactly-at-cutoff"]);
  });

  it("never deletes an in-flight row regardless of age (null ended_at)", async () => {
    seed(db, "ancient-live", "in-flight", null);

    const deleted = await pruneDownloadHistory(db, { maxAgeMs: 0 }, statFs({}));

    expect(deleted).toBe(0);
    expect(ids(db)).toEqual(["ancient-live"]);
  });

  it("prunes every terminal status when no partial survives (completed/failed/cancelled/interrupted)", async () => {
    seed(db, "c", "completed", NOW - 100 * DAY);
    seed(db, "f", "failed", NOW - 100 * DAY);
    seed(db, "x", "cancelled", NOW - 100 * DAY);
    seed(db, "i", "interrupted", NOW - 100 * DAY);

    expect(
      await pruneDownloadHistory(db, { maxAgeMs: 90 * DAY }, statFs({})),
    ).toBe(4);
    expect(ids(db)).toEqual([]);
  });

  it("returns 0 when nothing matches", async () => {
    seed(db, "fresh", "completed", NOW - 1 * DAY);
    expect(
      await pruneDownloadHistory(db, { maxAgeMs: 90 * DAY }, statFs({})),
    ).toBe(0);
    expect(ids(db)).toEqual(["fresh"]);
  });

  it("retains an aged KEEP-eligible row whose partial is still on disk", async () => {
    seed(db, "leftover", "failed", NOW - 200 * DAY, "/disk/partial");
    const fs = statFs({ "/disk/partial": 512 });

    const deleted = await pruneDownloadHistory(db, { maxAgeMs: 90 * DAY }, fs);

    expect(deleted).toBe(0);
    expect(ids(db)).toEqual(["leftover"]);
    // The fake fs exposes ONLY `stat` — no `unlink` — so the prune structurally
    // cannot remove the on-disk partial. Retained-not-unlinked is the contract.
    expect(fs).not.toHaveProperty("unlink");
  });

  it("prunes an aged KEEP-eligible row whose partial is already gone (ENOENT)", async () => {
    seed(db, "gone", "cancelled", NOW - 200 * DAY, "/disk/gone");
    const fs = statFs({}); // nothing on disk → stat rejects ENOENT

    const deleted = await pruneDownloadHistory(db, { maxAgeMs: 90 * DAY }, fs);

    expect(deleted).toBe(1);
    expect(ids(db)).toEqual([]);
  });

  it("prunes an aged completed row without consulting stat", async () => {
    seed(db, "done", "completed", NOW - 91 * DAY, "/disk/done");
    // Even a present file must NOT save a completed row: it is never in the
    // KEEP-eligible SELECT, so its disk state is never read.
    const fs = statFs({ "/disk/done": 999 });

    const deleted = await pruneDownloadHistory(db, { maxAgeMs: 90 * DAY }, fs);

    expect(deleted).toBe(1);
    expect(ids(db)).toEqual([]);
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it('degrades a per-row non-ENOENT stat error to "gone" and still prunes, without aborting', async () => {
    seed(db, "err", "failed", NOW - 200 * DAY, "/disk/err");
    const fs: PruneFs = {
      stat: vi.fn(async () => {
        const e = new Error(
          "EACCES: permission denied",
        ) as NodeJS.ErrnoException;
        e.code = "EACCES";
        throw e;
      }),
    };

    const deleted = await pruneDownloadHistory(db, { maxAgeMs: 90 * DAY }, fs);

    expect(deleted).toBe(1);
    expect(ids(db)).toEqual([]);
  });

  it("retains on-disk leftovers while pruning gone leftovers, completed, and never in-flight in one run", async () => {
    seed(db, "keep", "failed", NOW - 200 * DAY, "/disk/keep");
    seed(db, "gone", "cancelled", NOW - 200 * DAY, "/disk/gone");
    seed(db, "done", "completed", NOW - 200 * DAY, "/disk/done");
    seed(db, "live", "in-flight", null, "/disk/live");
    const fs = statFs({ "/disk/keep": 10 }); // only "keep" is on disk

    const deleted = await pruneDownloadHistory(db, { maxAgeMs: 90 * DAY }, fs);

    expect(deleted).toBe(2); // "gone" (file missing) + "done" (completed)
    expect(ids(db)).toEqual(["keep", "live"]);
  });
});
