// Composite lifecycle test (tasks.md 6.2). Ties the two durable-mirror
// halves together against ONE `downloads` table to pin their interaction:
//
//   1. A live download runs to completion through the registry
//      (set → update → finalize 'completed') → a durable `completed` row.
//   2. A prior process left a stranded `in-flight` row (not in THIS
//      process's registry memory) → the startup `sweepInterruptedDownloads`
//      terminalizes it to `interrupted`.
//   3. Terminal rows (the just-written `completed`, plus a pre-existing
//      `failed` / `cancelled`) are left untouched by the sweep.
//
// The load-bearing cross-component invariant: the sweep's
// `WHERE status='in-flight'` must NOT clobber the `completed` row the
// registry's `finalize` produced in the same database.
//
// Spec: openspec/changes/migrate-download-registry-to-sqlite/design.md
// Decisions 3 (registry single writer) + 5 (startup sweep).

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applyMigrations } from "../../db/migrations.js";
import {
  createDownloadRegistry,
  type DownloadJobEntry,
} from "../registry.js";
import { sweepInterruptedDownloads } from "../sweep-interrupted.js";

interface DownloadRow {
  status: string;
  bytes_downloaded: number;
  ended_at: number | null;
  failure_tag: string | null;
}

function readRow(db: Database.Database, id: string): DownloadRow {
  return db
    .prepare(
      `SELECT status, bytes_downloaded, ended_at, failure_tag
         FROM downloads WHERE download_job_id = ?`,
    )
    .get(id) as DownloadRow;
}

function makeEntry(overrides: Partial<DownloadJobEntry> = {}): DownloadJobEntry {
  return {
    downloadJobId: "live-A",
    datasourceId: "ds-1",
    sourcePath: "/welcome.pdf",
    targetPath: "/downloads/welcome.pdf",
    bytesDownloaded: 0,
    contentLength: 2_000_000,
    startedAt: 1_000,
    abortController: new AbortController(),
    ...overrides,
  };
}

// Seeds a row directly (no registry) to stand in for a prior process's write.
function seedRow(
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
       @id, 'ds-1', '/old.bin', '/dl/old.bin', 9999, NULL, @status, NULL,
       NULL, 500, 500, @endedAt
     )`,
  ).run({ id, status, endedAt });
}

describe("download lifecycle composite (registry finalize + startup sweep)", () => {
  it("a completed download coexists with a swept interrupted row; terminal rows survive the sweep", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const registry = createDownloadRegistry(db);

    // 1. Live download A runs to completion through the registry.
    registry.set(makeEntry());
    registry.update("live-A", { bytesDownloaded: 1_000_000 });
    registry.finalize("live-A", {
      status: "completed",
      bytesDownloaded: 2_000_000,
    });

    // After finalize, A's row is terminal and A is gone from memory.
    expect(registry.get("live-A")).toBeUndefined();
    expect(readRow(db, "live-A")).toMatchObject({
      status: "completed",
      bytes_downloaded: 2_000_000,
    });
    expect(readRow(db, "live-A").ended_at).not.toBeNull();

    // 2. A prior process's stranded rows: one in-flight orphan + two terminal.
    seedRow(db, "orphan-B", "in-flight", null);
    seedRow(db, "failed-C", "failed", 600);
    seedRow(db, "cancelled-D", "cancelled", 600);

    // 3. Startup sweep — only the orphan transitions.
    const swept = sweepInterruptedDownloads(db);
    expect(swept).toEqual(["orphan-B"]);

    expect(readRow(db, "orphan-B")).toMatchObject({ status: "interrupted" });
    expect(readRow(db, "orphan-B").ended_at).not.toBeNull();

    // The completed row the registry wrote is untouched by the sweep.
    expect(readRow(db, "live-A")).toMatchObject({
      status: "completed",
      bytes_downloaded: 2_000_000,
    });
    // Pre-existing terminal rows untouched.
    expect(readRow(db, "failed-C")).toMatchObject({
      status: "failed",
      ended_at: 600,
    });
    expect(readRow(db, "cancelled-D")).toMatchObject({
      status: "cancelled",
      ended_at: 600,
    });

    db.close();
  });
});
