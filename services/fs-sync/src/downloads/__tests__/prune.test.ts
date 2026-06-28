// Tests for `pruneDownloadHistory` (add-download-history-ui §3.1, design.md
// Decision 4). The prune deletes terminal `downloads` rows older than the
// window; it NEVER deletes the live `in-flight` row and — being pure SQL over
// the `downloads` table — structurally cannot touch on-disk files. The
// `downloads` table + its `status`/`ended_at` columns are owned by
// `migrate-download-registry-to-sqlite`.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyMigrations } from "../../db/migrations.js";
import { pruneDownloadHistory } from "../prune.js";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed epoch for deterministic boundaries

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

  it("deletes terminal rows older than maxAgeMs; keeps newer; never in-flight", () => {
    seed(db, "old-completed", "completed", NOW - 91 * DAY);
    seed(db, "new-failed", "failed", NOW - 10 * DAY);
    seed(db, "old-cancelled", "cancelled", NOW - 200 * DAY);
    seed(db, "live", "in-flight", null);

    const deleted = pruneDownloadHistory(db, { maxAgeMs: 90 * DAY });

    expect(deleted).toBe(2);
    expect(ids(db)).toEqual(["live", "new-failed"]);
  });

  it("age boundary is strict — a row exactly at the cutoff is kept", () => {
    seed(db, "exactly-at-cutoff", "completed", NOW - 90 * DAY);
    seed(db, "just-older", "completed", NOW - 90 * DAY - 1);

    const deleted = pruneDownloadHistory(db, { maxAgeMs: 90 * DAY });

    expect(deleted).toBe(1);
    expect(ids(db)).toEqual(["exactly-at-cutoff"]);
  });

  it("never deletes an in-flight row regardless of age (null ended_at)", () => {
    seed(db, "ancient-live", "in-flight", null);

    const deleted = pruneDownloadHistory(db, { maxAgeMs: 0 });

    expect(deleted).toBe(0);
    expect(ids(db)).toEqual(["ancient-live"]);
  });

  it("prunes every terminal status (completed/failed/cancelled/interrupted)", () => {
    seed(db, "c", "completed", NOW - 100 * DAY);
    seed(db, "f", "failed", NOW - 100 * DAY);
    seed(db, "x", "cancelled", NOW - 100 * DAY);
    seed(db, "i", "interrupted", NOW - 100 * DAY);

    expect(pruneDownloadHistory(db, { maxAgeMs: 90 * DAY })).toBe(4);
    expect(ids(db)).toEqual([]);
  });

  it("returns 0 when nothing matches", () => {
    seed(db, "fresh", "completed", NOW - 1 * DAY);
    expect(pruneDownloadHistory(db, { maxAgeMs: 90 * DAY })).toBe(0);
    expect(ids(db)).toEqual(["fresh"]);
  });
});
