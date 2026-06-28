// Unit tests for `sweepInterruptedDownloads` — the startup reconciliation
// that terminalizes crash/restart-orphaned download rows.
//
// Spec: openspec/changes/migrate-download-registry-to-sqlite/design.md
// "Decision 5" — on startup the service runs
//   UPDATE downloads SET status='interrupted', ended_at=now, updated_at=now
//   WHERE status='in-flight'
// Any `in-flight` row at startup is necessarily from a prior process (this
// process has started no downloads yet), so it records the interruption as a
// terminal `interrupted` status. Modeled on the `jobs`-table
// `recoverRunningJobs(db)` reconciliation. NEVER touches files on disk
// (bookkeeping only — replay is out of scope).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyMigrations } from "../../db/migrations.js";

import { sweepInterruptedDownloads } from "../sweep-interrupted.js";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
}

interface SeedRow {
  id: string;
  status: string;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number | null;
  bytes?: number;
  targetPath?: string;
}

function seed(db: Database.Database, row: SeedRow): void {
  db.prepare(
    `INSERT INTO downloads (
       download_job_id, datasource_id, source_path, target_path,
       bytes_downloaded, content_length, status, failure_tag,
       failure_message, started_at, updated_at, ended_at
     ) VALUES (
       @id, 'ds', '/src', @targetPath, @bytes, NULL, @status, NULL,
       NULL, @startedAt, @updatedAt, @endedAt
     )`,
  ).run({
    id: row.id,
    status: row.status,
    targetPath: row.targetPath ?? "/dst",
    bytes: row.bytes ?? 0,
    startedAt: row.startedAt ?? 1000,
    updatedAt: row.updatedAt ?? 1000,
    endedAt: row.endedAt ?? null,
  });
}

interface DownloadRow {
  download_job_id: string;
  status: string;
  bytes_downloaded: number;
  started_at: number;
  updated_at: number;
  ended_at: number | null;
}

function readRow(db: Database.Database, id: string): DownloadRow {
  return db
    .prepare(`SELECT * FROM downloads WHERE download_job_id = ?`)
    .get(id) as DownloadRow;
}

describe("sweepInterruptedDownloads", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions only in-flight rows to interrupted, stamping ended_at/updated_at=now and preserving bytes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    const db = makeDb();
    seed(db, {
      id: "a",
      status: "in-flight",
      startedAt: 1000,
      updatedAt: 2000,
      endedAt: null,
      bytes: 123,
    });
    seed(db, {
      id: "b",
      status: "in-flight",
      startedAt: 1500,
      updatedAt: 2500,
      endedAt: null,
    });
    // A terminal row that must be left untouched by the WHERE clause.
    seed(db, {
      id: "c",
      status: "completed",
      startedAt: 1000,
      updatedAt: 3000,
      endedAt: 3000,
    });

    const swept = sweepInterruptedDownloads(db);

    expect([...swept].sort()).toEqual(["a", "b"]);
    expect(readRow(db, "a")).toMatchObject({
      status: "interrupted",
      ended_at: 50_000,
      updated_at: 50_000,
      started_at: 1000, // unchanged
      bytes_downloaded: 123, // preserved, not reset
    });
    expect(readRow(db, "b")).toMatchObject({
      status: "interrupted",
      ended_at: 50_000,
      updated_at: 50_000,
    });
    // Completed row is byte-for-byte untouched.
    expect(readRow(db, "c")).toMatchObject({
      status: "completed",
      updated_at: 3000,
      ended_at: 3000,
    });
  });

  it("leaves every terminal status (completed/failed/cancelled/interrupted) untouched and returns []", () => {
    const db = makeDb();
    seed(db, { id: "c", status: "completed", updatedAt: 3000, endedAt: 3000 });
    seed(db, { id: "f", status: "failed", updatedAt: 3000, endedAt: 3000 });
    seed(db, { id: "x", status: "cancelled", updatedAt: 3000, endedAt: 3000 });
    seed(db, { id: "i", status: "interrupted", updatedAt: 3000, endedAt: 3000 });
    const ids = ["c", "f", "x", "i"];
    const before = ids.map((id) => readRow(db, id));

    const swept = sweepInterruptedDownloads(db);

    expect(swept).toHaveLength(0);
    expect(ids.map((id) => readRow(db, id))).toEqual(before);
  });

  it("is a no-op on a database with no rows", () => {
    const db = makeDb();
    expect(sweepInterruptedDownloads(db)).toHaveLength(0);
  });

  it("does not touch the on-disk partial file referenced by a swept row", () => {
    const db = makeDb();
    const file = path.join(
      os.tmpdir(),
      `ft5-sweep-${Date.now()}-${Math.random().toString(36).slice(2)}.part`,
    );
    fs.writeFileSync(file, "partial bytes");
    try {
      seed(db, { id: "a", status: "in-flight", targetPath: file });

      sweepInterruptedDownloads(db);

      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toBe("partial bytes");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
