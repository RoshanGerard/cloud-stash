// Tests for the `downloads:clear-history` handler (add-download-history-ui
// §4.1, design.md Decision 5). The handler deletes matching TERMINAL
// `downloads` rows by an optional status/age filter and returns the deleted
// count; it NEVER deletes the live `in-flight` row and — pure SQL over the
// `downloads` table — structurally cannot touch on-disk files. `Date.now()`
// drives the age filter, pinned here with fake timers.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DownloadTerminalStatus } from "@ft5/ipc-contracts/sync-service";

import { applyMigrations } from "../db/migrations.js";
import type { Connection } from "../ipc/server.js";

import { makeClearDownloadHistoryHandler } from "./downloads-clear-history.js";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

const ctx = (): { readonly connection: Connection } => ({
  connection: { id: 1, closed: false, sendEvent: () => void 0 },
});

function seed(
  db: Database.Database,
  id: string,
  status: string,
  endedAt: number | null,
): void {
  db.prepare(
    `INSERT INTO downloads (
       download_job_id, datasource_id, source_path, target_path,
       bytes_downloaded, content_length, status, failure_tag,
       failure_message, started_at, updated_at, ended_at
     ) VALUES (
       @id, 'ds-1', '/a', '/b', 100, NULL, @status, NULL, NULL, 0, 0, @endedAt
     )`,
  ).run({ id, status, endedAt });
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

    const res = await makeClearDownloadHistoryHandler({ db })({}, ctx());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 3 });
    expect(ids(db)).toEqual(["live"]);
  });

  it("restricts the delete to a status filter", async () => {
    seed(db, "f1", "failed", NOW - 1 * DAY);
    seed(db, "i1", "interrupted", NOW - 1 * DAY);
    seed(db, "c1", "completed", NOW - 1 * DAY);
    seed(db, "c2", "completed", NOW - 1 * DAY);

    const res = await makeClearDownloadHistoryHandler({ db })(
      { filter: { status: ["failed", "interrupted"] } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 2 });
    expect(ids(db)).toEqual(["c1", "c2"]);
  });

  it("restricts the delete to an olderThanMs filter", async () => {
    seed(db, "old", "completed", NOW - 40 * DAY);
    seed(db, "new", "cancelled", NOW - 5 * DAY);

    const res = await makeClearDownloadHistoryHandler({ db })(
      { filter: { olderThanMs: 30 * DAY } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 1 });
    expect(ids(db)).toEqual(["new"]);
  });

  it("combines status AND olderThanMs", async () => {
    seed(db, "old-failed", "failed", NOW - 40 * DAY);
    seed(db, "new-failed", "failed", NOW - 5 * DAY);
    seed(db, "old-completed", "completed", NOW - 40 * DAY);

    const res = await makeClearDownloadHistoryHandler({ db })(
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

    const res = await makeClearDownloadHistoryHandler({ db })(
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

    const res = await makeClearDownloadHistoryHandler({ db })(
      { filter: { status: [] } },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: 0 });
    expect(ids(db)).toEqual(["a"]);
  });

  it("never deletes in-flight even if a status filter names it", async () => {
    seed(db, "live", "in-flight", null);

    const res = await makeClearDownloadHistoryHandler({ db })(
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
