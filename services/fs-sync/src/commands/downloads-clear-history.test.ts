// Tests for the `downloads:clear-history` handler (add-download-history-ui
// §4.1, design.md Decision 5). The handler deletes matching TERMINAL
// `downloads` rows by an optional status/age filter and returns the deleted
// count; it NEVER deletes the live `in-flight` row. `Date.now()` drives the
// age filter, pinned here with fake timers.
//
// add-leftover-download-cleanup §4 (contract change): before deleting the
// matched rows, the handler unlinks the recorded `target_path` of every
// KEEP-eligible terminal row (`failed`/`cancelled`/`interrupted`) in the
// delete set. Completed rows' saved files are NEVER unlinked (the pre-delete
// SELECT excludes them even though the row DELETE still removes them). The
// unlink is best-effort — any error (ENOENT/EACCES/EPERM/…) is tolerated and
// never blocks the deletion nor alters the returned count. The filesystem
// `unlink` is injected so tests stay hermetic (never touch the real fs).

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DownloadTerminalStatus } from "@ft5/ipc-contracts/sync-service";

import { applyMigrations } from "../db/migrations.js";
import type { Connection } from "../ipc/server.js";

import type { ClearHistoryFs } from "../downloads/clear-history.js";

import { makeClearDownloadHistoryHandler } from "./downloads-clear-history.js";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

const ctx = (): { readonly connection: Connection } => ({
  connection: { id: 1, closed: false, sendEvent: () => void 0 },
});

/** No-op fake fs so hermetic tests never touch the real filesystem. */
function noopFs(): ClearHistoryFs {
  return { unlink: vi.fn(async () => void 0) };
}

/** A fake unlink that rejects with the given errno `code`. */
function errnoUnlink(code: string): (path: string) => Promise<void> {
  return async () => {
    throw Object.assign(new Error(`${code} test`), { code });
  };
}

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

describe("downloads:clear-history handler", () => {
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

  it("with no filter deletes all terminal rows, keeps in-flight, returns the count", async () => {
    seed(db, "a", "completed", NOW - 1 * DAY);
    seed(db, "b", "failed", NOW - 2 * DAY);
    seed(db, "c", "cancelled", NOW - 3 * DAY);
    seed(db, "live", "in-flight", null);

    const res = await makeClearDownloadHistoryHandler({ db, fs: noopFs() })(
      {},
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 3 });
    expect(ids(db)).toEqual(["live"]);
  });

  it("unlinks KEEP-eligible partials but keeps completed files", async () => {
    // A `failed` partial gets unlinked; a `completed` row's saved file is
    // left intact even though its row is deleted. This is the core safety
    // property of the contract change (the pre-delete SELECT excludes
    // completed rows from the unlink set).
    seed(db, "failed", "failed", NOW - 1 * DAY, "/downloads/failed.part");
    seed(db, "done", "completed", NOW - 2 * DAY, "/downloads/done.mp4");
    const unlinked: string[] = [];
    const unlink = vi.fn(async (p: string) => {
      unlinked.push(p);
    });

    const res = await makeClearDownloadHistoryHandler({ db, fs: { unlink } })(
      {},
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Both rows are removed from the table.
    expect(res.result).toEqual({ deleted: 2 });
    expect(ids(db)).toEqual([]);
    // Only the KEEP-eligible partial was unlinked; the completed file was not.
    expect(unlinked).toEqual(["/downloads/failed.part"]);
    expect(unlink).not.toHaveBeenCalledWith("/downloads/done.mp4");
  });

  it("unlink is best-effort and non-blocking (EACCES does not block the delete)", async () => {
    seed(db, "failed", "failed", NOW - 1 * DAY, "/downloads/failed.part");
    const unlink = vi.fn(errnoUnlink("EACCES"));

    const res = await makeClearDownloadHistoryHandler({ db, fs: { unlink } })(
      {},
      ctx(),
    );

    // The unlink rejection is swallowed: the row is still deleted and counted,
    // and the handler does not throw.
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 1 });
    expect(unlink).toHaveBeenCalledWith("/downloads/failed.part");
    expect(ids(db)).toEqual([]);
  });

  it("restricts the delete to a status filter and unlinks those rows' partials", async () => {
    seed(db, "f1", "failed", NOW - 1 * DAY, "/downloads/f1.part");
    seed(db, "i1", "interrupted", NOW - 1 * DAY, "/downloads/i1.part");
    seed(db, "c1", "completed", NOW - 1 * DAY, "/downloads/c1.mp4");
    seed(db, "c2", "completed", NOW - 1 * DAY, "/downloads/c2.mp4");
    const unlinked: string[] = [];
    const unlink = vi.fn(async (p: string) => {
      unlinked.push(p);
    });

    const res = await makeClearDownloadHistoryHandler({ db, fs: { unlink } })(
      { filter: { status: ["failed", "interrupted"] } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 2 });
    expect(ids(db)).toEqual(["c1", "c2"]);
    // The two deleted KEEP-eligible rows' partials are unlinked (best-effort);
    // the untouched completed rows' files are never passed to unlink.
    expect(unlinked.sort()).toEqual(["/downloads/f1.part", "/downloads/i1.part"]);
    expect(unlink).not.toHaveBeenCalledWith("/downloads/c1.mp4");
    expect(unlink).not.toHaveBeenCalledWith("/downloads/c2.mp4");
  });

  it("restricts the delete to an olderThanMs filter", async () => {
    seed(db, "old", "completed", NOW - 40 * DAY);
    seed(db, "new", "cancelled", NOW - 5 * DAY);
    const unlink = vi.fn(async () => void 0);

    const res = await makeClearDownloadHistoryHandler({ db, fs: { unlink } })(
      { filter: { olderThanMs: 30 * DAY } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 1 });
    expect(ids(db)).toEqual(["new"]);
    // The one deleted row is `completed` → no on-disk file is touched.
    expect(unlink).not.toHaveBeenCalled();
  });

  it("combines status AND olderThanMs", async () => {
    seed(db, "old-failed", "failed", NOW - 40 * DAY);
    seed(db, "new-failed", "failed", NOW - 5 * DAY);
    seed(db, "old-completed", "completed", NOW - 40 * DAY);

    const res = await makeClearDownloadHistoryHandler({ db, fs: noopFs() })(
      { filter: { status: ["failed"], olderThanMs: 30 * DAY } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 1 }); // only old-failed
    expect(ids(db)).toEqual(["new-failed", "old-completed"]);
  });

  it("never deletes in-flight even with olderThanMs: 0", async () => {
    seed(db, "live", "in-flight", null);
    seed(db, "term", "completed", NOW - 1 * DAY);

    const res = await makeClearDownloadHistoryHandler({ db, fs: noopFs() })(
      { filter: { olderThanMs: 0 } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 1 });
    expect(ids(db)).toEqual(["live"]);
  });

  it("treats an explicit empty status set as matching nothing", async () => {
    seed(db, "a", "completed", NOW - 1 * DAY);
    const unlink = vi.fn(async () => void 0);

    const res = await makeClearDownloadHistoryHandler({ db, fs: { unlink } })(
      { filter: { status: [] } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 0 });
    expect(ids(db)).toEqual(["a"]);
    // Nothing matched → nothing unlinked.
    expect(unlink).not.toHaveBeenCalled();
  });

  it("never deletes in-flight even if a status filter names it", async () => {
    seed(db, "live", "in-flight", null);

    const res = await makeClearDownloadHistoryHandler({ db, fs: noopFs() })(
      // "in-flight" is not a DownloadTerminalStatus; the status != 'in-flight'
      // guard must protect the live row regardless of a hostile filter.
      { filter: { status: ["in-flight" as DownloadTerminalStatus] } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 0 });
    expect(ids(db)).toEqual(["live"]);
  });
});
