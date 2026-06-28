// Bootstrap ordering observer test. Boots the service against a scratch
// data dir with a deterministic `BootstrapObserver` spy, then asserts the
// exact sequence of stages fired during startup matches the spec-mandated
// order (see
// openspec/changes/wire-fs-sync-service/specs/fs-sync-service/spec.md —
// "Bootstrap order is observable" scenario, expanded by tasks.md 2.1).
//
// migrate-download-registry-to-sqlite adds the `sweep-interrupted-downloads`
// stage immediately after `recover-running-jobs` (both run after the PID
// guard, before ipc-listen). The functional `bootstrap interrupted-download
// sweep` block below pins the spec requirement "Interrupted downloads are
// swept to a terminal status on service startup" (Decision 5): in-flight
// rows become `interrupted` on a clean boot, and the sweep never runs when
// the PID guard is already held by another instance.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../db/migrations.js";

import {
  AlreadyRunningError,
  bootstrap,
  type BootstrapStage,
  type Runtime,
} from "./bootstrap.js";

let scratchDir: string;
let runtime: Runtime | null = null;

function pipeFor(tag: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\ft5-sync-boot-${tag}-${suffix}`;
  }
  return path.join(os.tmpdir(), `ft5-sync-boot-${tag}-${suffix}.sock`);
}

beforeEach(async () => {
  scratchDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ft5-sync-bootstrap-"));
  runtime = null;
});

afterEach(async () => {
  try {
    if (runtime) await runtime.stop();
  } finally {
    runtime = null;
    try {
      await fsp.rm(scratchDir, { recursive: true, force: true });
    } catch {
      /* tolerated */
    }
  }
});

describe("bootstrap ordering", () => {
  it("fires the 14 bootstrap stages in the spec-mandated order", async () => {
    const observed: BootstrapStage[] = [];
    const pipePath = pipeFor("order");

    runtime = await bootstrap({
      dev: true,
      dataDir: scratchDir,
      pidPath: path.join(scratchDir, "service-dev.pid"),
      dbPath: path.join(scratchDir, "sync.db"),
      socketPath: pipePath,
      credentialsPath: path.join(scratchDir, "credentials.json"),
      observer: {
        onStage(stage) {
          observed.push(stage);
        },
      },
    });

    // The test-level assertion: every stage fires exactly once, in order.
    // `construct-service-config-store` was added by implement-datasource-
    // onboarding §6.4; it sits between credential-store and provider-registry
    // so the OAuth app config is available before any factory.createForAuth
    // call. `construct-loopback-broker` was added by §9; it sits between
    // network-probe and recover-running-jobs so the broker has the engine
    // context (factory + credential store) it needs at construction time,
    // and the IPC listener binds AFTER the broker is ready to handle
    // authenticate-start dispatches. `sweep-interrupted-downloads` was added
    // by migrate-download-registry-to-sqlite (Decision 5); it sits right
    // after recover-running-jobs — both are post-PID-guard startup
    // reconciliations (jobs table / downloads table) that run before the IPC
    // listener so no client observes half-state.
    const expected: BootstrapStage[] = [
      "open-database",
      "apply-migrations",
      "integrity-ok",
      "acquire-pid-guard",
      "construct-credential-store",
      "construct-service-config-store",
      "construct-provider-registry",
      "construct-client-factory",
      "construct-scheduler",
      "construct-network-probe",
      "construct-loopback-broker",
      "recover-running-jobs",
      "sweep-interrupted-downloads",
      "ipc-listen",
    ];
    expect(observed).toEqual(expected);
    // The sweep runs strictly after the PID guard is acquired (Decision 5),
    // so only the single-instance-winning process ever mutates in-flight rows.
    expect(observed.indexOf("sweep-interrupted-downloads")).toBeGreaterThan(
      observed.indexOf("acquire-pid-guard"),
    );

    // IPC listen is the LAST observable side-effect before the runtime is
    // returned — sanity-check the socketPath surface.
    expect(runtime.socketPath).toBe(pipePath);
  });

  it("settles stop() without leaking timers when no jobs are queued", async () => {
    runtime = await bootstrap({
      dev: true,
      dataDir: scratchDir,
      pidPath: path.join(scratchDir, "service-dev.pid"),
      dbPath: path.join(scratchDir, "sync.db"),
      socketPath: pipeFor("stop"),
      credentialsPath: path.join(scratchDir, "credentials.json"),
    });

    const t0 = Date.now();
    await runtime.stop();
    runtime = null;
    const elapsed = Date.now() - t0;
    // Stop should be near-instant with an idle scheduler + disarmed probe.
    // A 500ms budget absorbs CI jitter while still catching a regression
    // where someone forgets clearInterval and stop waits a full poll tick.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("bootstrap interrupted-download sweep", () => {
  // Seeds the `downloads` rows a prior process would have left behind, then
  // closes the connection so bootstrap can re-open the same file.
  function seedDownloads(
    dbPath: string,
    rows: Array<{ id: string; status: string; endedAt: number | null }>,
  ): void {
    const db = new Database(dbPath);
    try {
      applyMigrations(db);
      const insert = db.prepare(
        `INSERT INTO downloads (
           download_job_id, datasource_id, source_path, target_path,
           bytes_downloaded, content_length, status, failure_tag,
           failure_message, started_at, updated_at, ended_at
         ) VALUES (
           @id, 'ds-1', '/a.bin', '/dl/a.bin', 4096, NULL, @status, NULL,
           NULL, 1000, 1000, @endedAt
         )`,
      );
      for (const r of rows) {
        insert.run({ id: r.id, status: r.status, endedAt: r.endedAt });
      }
    } finally {
      db.close();
    }
  }

  interface SweepRow {
    status: string;
    ended_at: number | null;
    bytes_downloaded: number;
  }

  it("terminalizes orphaned in-flight rows to interrupted on a clean boot, leaving terminal rows untouched", async () => {
    const dbPath = path.join(scratchDir, "sync.db");
    seedDownloads(dbPath, [
      { id: "orphan-1", status: "in-flight", endedAt: null },
      { id: "orphan-2", status: "in-flight", endedAt: null },
      { id: "done-1", status: "completed", endedAt: 2000 },
    ]);

    runtime = await bootstrap({
      dev: true,
      dataDir: scratchDir,
      pidPath: path.join(scratchDir, "service-dev.pid"),
      dbPath,
      socketPath: pipeFor("sweep"),
      credentialsPath: path.join(scratchDir, "credentials.json"),
    });

    const read = (id: string): SweepRow =>
      runtime!.db
        .prepare(
          `SELECT status, ended_at, bytes_downloaded
             FROM downloads WHERE download_job_id = ?`,
        )
        .get(id) as SweepRow;

    expect(read("orphan-1")).toMatchObject({ status: "interrupted" });
    expect(read("orphan-1").ended_at).not.toBeNull();
    expect(read("orphan-1").bytes_downloaded).toBe(4096); // preserved
    expect(read("orphan-2")).toMatchObject({ status: "interrupted" });
    expect(read("orphan-2").ended_at).not.toBeNull();
    // Completed row is untouched (status + ended_at unchanged).
    expect(read("done-1")).toMatchObject({ status: "completed", ended_at: 2000 });
  });

  it("does not sweep when the PID guard is already held by another instance", async () => {
    const dbPath = path.join(scratchDir, "sync.db");
    const pidPath = path.join(scratchDir, "service-dev.pid");
    seedDownloads(dbPath, [{ id: "orphan-1", status: "in-flight", endedAt: null }]);

    // Simulate another live service instance owning the data dir: write THIS
    // process's PID (a live `node` image) so bootstrap's stage-4 guard throws
    // AlreadyRunningError before it can reach the stage-12 sweep.
    await fsp.writeFile(pidPath, `${process.pid}\n`, "utf8");

    await expect(
      bootstrap({
        dev: true,
        dataDir: scratchDir,
        pidPath,
        dbPath,
        socketPath: pipeFor("sweep-blocked"),
        credentialsPath: path.join(scratchDir, "credentials.json"),
      }),
    ).rejects.toBeInstanceOf(AlreadyRunningError);

    // The in-flight row must be untouched — the sweep never ran because the
    // single-instance guard rejected this process at stage 4.
    const db = new Database(dbPath);
    try {
      const row = db
        .prepare(
          `SELECT status, ended_at FROM downloads WHERE download_job_id = ?`,
        )
        .get("orphan-1") as { status: string; ended_at: number | null };
      expect(row.status).toBe("in-flight");
      expect(row.ended_at).toBeNull();
    } finally {
      db.close();
    }
  });
});
