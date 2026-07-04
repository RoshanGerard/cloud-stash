// Tests for the `downloads:list-leftover` handler
// (add-leftover-download-cleanup §3). The handler projects every
// KEEP-eligible terminal `downloads` row (`failed` / `cancelled` /
// `interrupted`) whose recorded `target_path` still exists on disk to a
// `LeftoverEntry`, with `sizeOnDisk` taken from a service-side `stat`. It is
// read-only, never resolves an engine client, and NEVER throws: a `stat`
// rejection (ENOENT or any other error) means the file is gone / not a live
// leftover, so the row is silently skipped — unlike delete-partial, an errored
// stat is NOT surfaced as an error envelope. Completed / in-flight rows are
// excluded. Entries are ordered by `ended_at` descending. The filesystem
// `stat` is injected so tests stay hermetic.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../db/migrations.js";
import type { Connection } from "../ipc/server.js";

import {
  makeListLeftoverHandler,
  type ListLeftoverFs,
} from "./downloads-list-leftover.js";

const ctx = (): { readonly connection: Connection } => ({
  connection: { id: 1, closed: false, sendEvent: () => void 0 },
});

interface SeedOpts {
  readonly failureTag?: string | null;
  readonly failureMessage?: string | null;
  readonly datasourceId?: string;
  readonly sourcePath?: string;
}

function seed(
  db: Database.Database,
  id: string,
  status: string,
  targetPath: string,
  endedAt: number | null,
  opts: SeedOpts = {},
): void {
  db.prepare(
    `INSERT INTO downloads (
       download_job_id, datasource_id, source_path, target_path,
       bytes_downloaded, content_length, status, failure_tag,
       failure_message, started_at, updated_at, ended_at
     ) VALUES (
       @id, @dsId, @sourcePath, @targetPath, 100, NULL, @status,
       @failureTag, @failureMessage, 0, 0, @endedAt
     )`,
  ).run({
    id,
    dsId: opts.datasourceId ?? "ds-1",
    sourcePath: opts.sourcePath ?? "/a",
    targetPath,
    status,
    failureTag: opts.failureTag ?? null,
    failureMessage: opts.failureMessage ?? null,
    endedAt,
  });
}

/**
 * Fake fs `stat` port: resolves `{ size }` for every path present in
 * `present`, and rejects with the given errno code (default ENOENT) for
 * anything else — modelling a file that is no longer on disk.
 */
function fakeFs(
  present: Record<string, number>,
  missingCode = "ENOENT",
): ListLeftoverFs {
  return {
    async stat(p: string): Promise<{ size: number }> {
      if (Object.prototype.hasOwnProperty.call(present, p)) {
        return { size: present[p]! };
      }
      throw Object.assign(new Error(`${missingCode} test`), {
        code: missingCode,
      });
    },
  };
}

describe("downloads:list-leftover handler", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns KEEP-eligible on-disk rows ordered by ended_at DESC, sizeOnDisk from stat", async () => {
    // Seed intentionally OUT of sorted order (lower ended_at first) so the
    // assertion actually exercises `ORDER BY ended_at DESC`.
    seed(db, "job-fail", "failed", "/dl/fail.part", 3000); // included, mid
    seed(db, "job-cx", "cancelled", "/dl/cx.part", 5000); // included, newest
    seed(db, "job-int", "interrupted", "/dl/int.part", 1000); // included, oldest
    seed(db, "job-done", "completed", "/dl/done.mp4", 4000); // EXCLUDED (completed)
    seed(db, "job-live", "in-flight", "/dl/live.part", null); // EXCLUDED (in-flight)
    seed(db, "job-gone", "failed", "/dl/gone.part", 9999); // EXCLUDED (stat ENOENT)

    const fs = fakeFs({
      "/dl/fail.part": 512,
      "/dl/cx.part": 1024,
      "/dl/int.part": 256,
      "/dl/done.mp4": 9_000_000, // on disk but completed → excluded
      "/dl/live.part": 7, // on disk but in-flight → excluded
      // "/dl/gone.part" deliberately absent → stat rejects → excluded
    });

    const res = await makeListLeftoverHandler({ db, fs })({}, ctx());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { entries } = res.result;
    expect(entries.map((e) => e.downloadJobId)).toEqual([
      "job-cx", // ended 5000
      "job-fail", // ended 3000
      "job-int", // ended 1000
    ]);
    expect(entries.map((e) => e.sizeOnDisk)).toEqual([1024, 512, 256]);
  });

  it("projects the row's stored failureTag / failureMessage / endedAt / paths", async () => {
    seed(db, "job-x", "failed", "/dl/x.part", 4242, {
      failureTag: "network",
      failureMessage: "boom",
      datasourceId: "ds-7",
      sourcePath: "/remote/x.bin",
    });
    const fs = fakeFs({ "/dl/x.part": 8080 });

    const res = await makeListLeftoverHandler({ db, fs })({}, ctx());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.entries).toEqual([
      {
        downloadJobId: "job-x",
        datasourceId: "ds-7",
        sourcePath: "/remote/x.bin",
        targetPath: "/dl/x.part",
        sizeOnDisk: 8080,
        failureTag: "network",
        failureMessage: "boom",
        endedAt: 4242,
      },
    ]);
  });

  it("excludes a KEEP-eligible row whose stat rejects with ENOENT (file gone) — never throws", async () => {
    seed(db, "job-gone", "failed", "/dl/gone.part", 1000);
    const fs = fakeFs({}); // every stat rejects with ENOENT

    const res = await makeListLeftoverHandler({ db, fs })({}, ctx());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.entries).toEqual([]);
  });

  it("excludes a KEEP-eligible row whose stat rejects with a NON-ENOENT error (e.g. EACCES) — silently skipped, not an error envelope", async () => {
    // Unlike delete-partial (which surfaces EACCES as an error envelope), a
    // list stat that rejects for ANY reason just means "not a live leftover":
    // the row is skipped and the handler still returns ok. Guards against
    // accidentally carrying over delete-partial's error-distinguishing pattern.
    seed(db, "job-locked", "cancelled", "/dl/locked.part", 2000);
    const fs = fakeFs({}, "EACCES"); // stat rejects with EACCES

    const res = await makeListLeftoverHandler({ db, fs })({}, ctx());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.entries).toEqual([]);
  });

  it("returns an empty result when the table holds no rows", async () => {
    const fs = fakeFs({});

    const res = await makeListLeftoverHandler({ db, fs })({}, ctx());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.entries).toEqual([]);
  });

  it("excludes completed and in-flight rows even when their target_path is on disk", async () => {
    seed(db, "job-done", "completed", "/dl/done.mp4", 5000);
    seed(db, "job-live", "in-flight", "/dl/live.part", null);
    const fs = fakeFs({ "/dl/done.mp4": 1000, "/dl/live.part": 2000 });

    const res = await makeListLeftoverHandler({ db, fs })({}, ctx());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.entries).toEqual([]);
  });
});
