// Tests for the `downloads:delete-partial` handler
// (add-failed-download-cleanup-affordance §2). The handler deletes the
// partial file recorded on a TERMINAL `downloads` row, keyed by
// `downloadJobId` (the path is resolved server-side — never passed over the
// wire). Guard is "terminal + recorded": an unknown job is a no-op success;
// an `in-flight` row is refused (never unlink an actively-written file). An
// already-gone file (ENOENT) counts as success; EACCES/EPERM surface an
// error envelope. The filesystem `unlink` is injected so tests stay hermetic.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyMigrations } from "../db/migrations.js";
import type { Connection } from "../ipc/server.js";

import { makeDeletePartialHandler } from "./downloads-delete-partial.js";

const ctx = (): { readonly connection: Connection } => ({
  connection: { id: 1, closed: false, sendEvent: () => void 0 },
});

function seed(
  db: Database.Database,
  id: string,
  status: string,
  targetPath: string,
): void {
  db.prepare(
    `INSERT INTO downloads (
       download_job_id, datasource_id, source_path, target_path,
       bytes_downloaded, content_length, status, failure_tag,
       failure_message, started_at, updated_at, ended_at
     ) VALUES (
       @id, 'ds-1', '/a', @targetPath, 100, NULL, @status, NULL, NULL, 0, 0, 0
     )`,
  ).run({ id, status, targetPath });
}

function errnoUnlink(code: string): (path: string) => Promise<void> {
  return async () => {
    throw Object.assign(new Error(`${code} test`), { code });
  };
}

describe("downloads:delete-partial handler", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("unlinks the recorded partial of a terminal row and returns deleted:true", async () => {
    seed(db, "job-A", "failed", "/downloads/seed.mp4");
    const unlink = vi.fn(async () => void 0);

    const res = await makeDeletePartialHandler({ db, fs: { unlink } })(
      { downloadJobId: "job-A" },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: true });
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith("/downloads/seed.mp4");
  });

  it("treats an already-gone partial (ENOENT) as deleted:true", async () => {
    seed(db, "job-A", "failed", "/downloads/seed.mp4");
    const unlink = vi.fn(errnoUnlink("ENOENT"));

    const res = await makeDeletePartialHandler({ db, fs: { unlink } })(
      { downloadJobId: "job-A" },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: true });
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it("is a no-op success (deleted:false) for an unknown downloadJobId — no unlink", async () => {
    const unlink = vi.fn(async () => void 0);

    const res = await makeDeletePartialHandler({ db, fs: { unlink } })(
      { downloadJobId: "nope" },
      ctx(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ deleted: false });
    expect(unlink).not.toHaveBeenCalled();
  });

  it("refuses an in-flight row with an error envelope — no unlink", async () => {
    seed(db, "live", "in-flight", "/downloads/live.part");
    const unlink = vi.fn(async () => void 0);

    const res = await makeDeletePartialHandler({ db, fs: { unlink } })(
      { downloadJobId: "live" },
      ctx(),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.tag).toBe("other");
    expect(res.error.message).toMatch(/in[-\s]?flight/i);
    expect(res.error.retryable).toBe(false);
    expect(unlink).not.toHaveBeenCalled();
  });

  it("surfaces a permission error (EACCES) as an error envelope", async () => {
    seed(db, "job-A", "failed", "/downloads/seed.mp4");
    const unlink = vi.fn(errnoUnlink("EACCES"));

    const res = await makeDeletePartialHandler({ db, fs: { unlink } })(
      { downloadJobId: "job-A" },
      ctx(),
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.tag).toBe("other");
    expect(res.error.retryable).toBe(false);
    expect(res.error.message).toMatch(/EACCES|delete/i);
  });
});
