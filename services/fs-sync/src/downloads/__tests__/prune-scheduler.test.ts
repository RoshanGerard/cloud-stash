// Tests for the config-gated download-history prune scheduler
// (add-download-history-ui §3.3, design.md Decision 4). On start the scheduler
// prunes once, then re-prunes every 24h; each run re-reads the retention
// policy from config and skips entirely when `autoPrune` is off. The interval
// timer is cleared on `stop()`. Fake timers drive the window math + the 24h
// cadence deterministically.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServiceConfig } from "@cloudstash/ipc-contracts/sync-service";

import { applyMigrations } from "../../db/migrations.js";
import { createPruneScheduler, PRUNE_INTERVAL_MS } from "../prune-scheduler.js";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

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

function count(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM downloads`).get() as { c: number }).c;
}

/** A `stat` port with no files on disk — every path rejects with ENOENT. */
function goneFs(): { stat(path: string): Promise<{ size: number }> } {
  return {
    stat: async (p: string) => {
      const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    },
  };
}

function configWith(downloadHistory?: ServiceConfig["downloadHistory"]): ServiceConfig {
  return { schemaVersion: 1, providers: {}, downloadHistory };
}

describe("download-history prune scheduler", () => {
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

  it("prunes aged terminal rows on start when autoPrune is on", async () => {
    seed(db, "old", "completed", NOW - 100 * DAY);
    seed(db, "new", "completed", NOW - 1 * DAY);
    const sched = createPruneScheduler({
      db,
      readConfig: async () => configWith({ autoPrune: true, retentionDays: 90 }),
    });

    await sched.start();

    expect(count(db)).toBe(1); // only "new" remains
    sched.stop();
  });

  it("skips pruning entirely when autoPrune is off", async () => {
    seed(db, "ancient", "completed", NOW - 999 * DAY);
    const sched = createPruneScheduler({
      db,
      readConfig: async () => configWith({ autoPrune: false, retentionDays: 30 }),
    });

    await sched.start();

    expect(count(db)).toBe(1); // nothing deleted
    sched.stop();
  });

  it("uses retentionDays from config for the window math", async () => {
    seed(db, "d40", "completed", NOW - 40 * DAY);
    const sched = createPruneScheduler({
      db,
      readConfig: async () => configWith({ autoPrune: true, retentionDays: 30 }),
    });

    await sched.start();

    expect(count(db)).toBe(0); // 40d > 30d window
    sched.stop();
  });

  it("re-prunes on the 24h tick using the latest table state", async () => {
    const sched = createPruneScheduler({
      db,
      readConfig: async () => configWith({ autoPrune: true, retentionDays: 30 }),
      fs: goneFs(),
    });
    await sched.start();
    expect(count(db)).toBe(0);

    // A newly-aged KEEP-eligible row appears after start; its partial is gone
    // (goneFs), so the next 24h tick prunes it.
    seed(db, "appeared", "failed", NOW - 31 * DAY);
    expect(count(db)).toBe(1);

    await vi.advanceTimersByTimeAsync(PRUNE_INTERVAL_MS);

    expect(count(db)).toBe(0);
    sched.stop();
  });

  it("threads the injected fs — an aged KEEP-eligible row whose partial is on disk is retained", async () => {
    // Load-bearing: if `runOnce` dropped `deps.fs` and fell back to the real
    // node stat, "/disk/partial" would reject → the row would be pruned →
    // count 0 → this test fails. A resolving fake fs is the only shape that
    // proves `deps.fs` reached `pruneDownloadHistory`.
    seed(db, "leftover", "failed", NOW - 200 * DAY, "/disk/partial");
    const sched = createPruneScheduler({
      db,
      readConfig: async () => configWith({ autoPrune: true, retentionDays: 90 }),
      fs: {
        stat: async (p: string) => {
          if (p === "/disk/partial") return { size: 128 };
          const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
          e.code = "ENOENT";
          throw e;
        },
      },
    });

    await sched.start();

    expect(count(db)).toBe(1); // retained because its partial is on disk
    sched.stop();
  });

  it("clears its interval timer on stop — no prune after shutdown", async () => {
    const sched = createPruneScheduler({
      db,
      readConfig: async () => configWith({ autoPrune: true, retentionDays: 30 }),
    });
    await sched.start();
    sched.stop();

    seed(db, "post-stop", "completed", NOW - 90 * DAY);
    await vi.advanceTimersByTimeAsync(PRUNE_INTERVAL_MS * 2);

    expect(count(db)).toBe(1); // never pruned after stop
  });

  it("does NOT throw when readConfig rejects — start resolves and the cycle is skipped", async () => {
    // ServiceConfigStore.getRaw rethrows on a malformed/unparseable config
    // (only ENOENT yields the default). Autonomous retention must degrade to
    // "skip this cycle", never crash the service or leave an unhandled
    // rejection on the 24h tick (review C2; Decision 2 defensive-read intent).
    seed(db, "old", "completed", NOW - 100 * DAY);
    const sched = createPruneScheduler({
      db,
      readConfig: async () => {
        throw new Error("config.json is corrupt");
      },
    });

    await expect(sched.start()).resolves.toBeUndefined();
    expect(count(db)).toBe(1); // nothing pruned, nothing thrown

    // A subsequent 24h tick must also swallow the rejection.
    await vi.advanceTimersByTimeAsync(PRUNE_INTERVAL_MS);
    expect(count(db)).toBe(1);

    sched.stop();
  });

  it("falls back to default (autoPrune on, 90d) when downloadHistory is absent", async () => {
    seed(db, "old", "completed", NOW - 100 * DAY);
    seed(db, "mid", "completed", NOW - 60 * DAY);
    const sched = createPruneScheduler({
      db,
      readConfig: async () => configWith(undefined),
    });

    await sched.start();

    expect(count(db)).toBe(1); // default 90d → 100d pruned, 60d kept
    sched.stop();
  });
});
