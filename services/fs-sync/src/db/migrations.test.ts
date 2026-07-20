import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, CURRENT_SCHEMA_VERSION } from "./migrations.js";

// The real drizzle/ dir is a sibling of src/ (services/fs-sync/drizzle).
// This test file lives under src/db/, so walk up two levels then into drizzle/.
function repoDrizzleDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "drizzle");
}

let cleanup: string[] = [];

afterEach(async () => {
  for (const f of cleanup) {
    try {
      await fsp.rm(f, { recursive: true, force: true });
    } catch {
      /* tolerated */
    }
  }
  cleanup = [];
});

function scratchDbPath(): string {
  const f = path.join(
    os.tmpdir(),
    `cloudstash-sync-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  cleanup.push(f);
  return f;
}

describe("applyMigrations", () => {
  it("creates all five core tables on a fresh DB", () => {
    const db = new Database(scratchDbPath());
    try {
      applyMigrations(db);
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "downloads",
          "jobs",
          "retry_policies",
          "schema_migrations",
          "service_meta",
          "sync_snapshot",
        ]),
      );
    } finally {
      db.close();
    }
  });

  it("creates the downloads table with both indexes and schemaVersion = 2 on a fresh DB", () => {
    const db = new Database(scratchDbPath());
    try {
      applyMigrations(db);

      // The downloads table exists.
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'")
        .get();
      expect(table).toBeTruthy();

      // Both explicit indexes exist (an implicit sqlite_autoindex for the
      // TEXT PRIMARY KEY is also present, so assert containment, not equality).
      const indexNames = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='downloads'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(indexNames).toEqual(
        expect.arrayContaining(["downloads_status_idx", "downloads_started_at_idx"]),
      );

      // Fresh install seeds schema_version = 2.
      const meta = db.prepare("SELECT schema_version FROM service_meta").get() as {
        schema_version: number;
      };
      expect(meta.schema_version).toBe(2);
    } finally {
      db.close();
    }
  });

  it("migrates an existing v1 DB forward-only: adds downloads, records 0002, leaves other rows intact and schema_version at 1", () => {
    const file = scratchDbPath();
    const db = new Database(file);
    try {
      // Establish a faithful v1 state directly (NOT via applyMigrations, which
      // would seed service_meta at the bumped version and defeat the premise):
      // the 0001 tables, a recorded 0001 migration, a v1 service_meta row, and
      // a sentinel row in another table.
      const initialSql = fs.readFileSync(path.join(repoDrizzleDir(), "0001_initial.sql"), "utf8");
      db.exec(initialSql);
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        "0001_initial.sql",
        Date.now(),
      );
      db.prepare(
        "INSERT INTO service_meta (id, schema_version, installed_at, service_uuid) VALUES (?, ?, ?, ?)",
      ).run(1, 1, Date.now(), "00000000-0000-0000-0000-000000000001");
      db.prepare(
        "INSERT INTO retry_policies (scope, datasource_id, max_attempts, backoff_ms, backoff_strategy, max_age_ms) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("global", "", 5, 1000, "exponential", null);

      // No downloads table yet, 0002 not recorded.
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'").get(),
      ).toBeFalsy();

      // Forward-only migration on next start.
      applyMigrations(db);

      // downloads table now exists.
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'").get(),
      ).toBeTruthy();

      // schema_migrations now records both files.
      const migs = (
        db.prepare("SELECT name FROM schema_migrations ORDER BY name").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name);
      expect(migs).toEqual(["0001_initial.sql", "0002_downloads.sql"]);

      // The pre-existing retry_policies sentinel row is unchanged.
      const sentinel = db
        .prepare(
          "SELECT max_attempts FROM retry_policies WHERE scope='global' AND datasource_id=''",
        )
        .get() as { max_attempts: number };
      expect(sentinel.max_attempts).toBe(5);

      // Forward-only migrations are filename-tracked, independent of the seeded
      // version value: the existing v1 service_meta row keeps schema_version = 1
      // (Decision 6 — the version is not bumped on upgrade).
      const meta = db.prepare("SELECT schema_version FROM service_meta").get() as {
        schema_version: number;
      };
      expect(meta.schema_version).toBe(1);
    } finally {
      db.close();
    }
  });

  it("seeds service_meta with exactly one row carrying schemaVersion = 2", () => {
    const db = new Database(scratchDbPath());
    try {
      applyMigrations(db);
      const rows = db
        .prepare("SELECT schema_version, service_uuid FROM service_meta")
        .all() as Array<{ schema_version: number; service_uuid: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.schema_version).toBe(CURRENT_SCHEMA_VERSION);
      expect(rows[0]?.service_uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    } finally {
      db.close();
    }
  });

  it("is idempotent (second application is a no-op)", () => {
    const file = scratchDbPath();
    const db = new Database(file);
    try {
      applyMigrations(db);
      const firstUuid = (
        db.prepare("SELECT service_uuid FROM service_meta").get() as {
          service_uuid: string;
        }
      ).service_uuid;

      applyMigrations(db);
      const secondUuid = (
        db.prepare("SELECT service_uuid FROM service_meta").get() as {
          service_uuid: string;
        }
      ).service_uuid;

      expect(secondUuid).toBe(firstUuid);
      const count = (
        db.prepare("SELECT COUNT(*) as c FROM service_meta").get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("records each migration in schema_migrations", () => {
    const db = new Database(scratchDbPath());
    try {
      applyMigrations(db);
      const rows = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all() as Array<{
        name: string;
      }>;
      expect(rows.map((r) => r.name)).toEqual(["0001_initial.sql", "0002_downloads.sql"]);
    } finally {
      db.close();
    }
  });

  it("honours a custom migrationsDir option (forward-compat)", async () => {
    const dir = path.join(
      os.tmpdir(),
      `cloudstash-sync-mig-custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    cleanup.push(dir);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "0001_test.sql"), "CREATE TABLE custom_t (x INTEGER);");
    const db = new Database(scratchDbPath());
    try {
      applyMigrations(db, { migrationsDir: dir });
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_t'")
        .get();
      expect(row).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
