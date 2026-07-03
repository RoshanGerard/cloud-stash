// `downloads:delete-partial` command handler
// (add-failed-download-cleanup-affordance §2). Deletes the partial file
// recorded on a TERMINAL `downloads` row, keyed by `downloadJobId` — the
// path is resolved server-side from the durable row, so NO filesystem path
// crosses IPC. Guard is "terminal + recorded":
//   - unknown `downloadJobId` (no row)  → no-op success `{ deleted: false }`;
//   - `status === 'in-flight'`          → refuse (never unlink a file that is
//                                          still being actively written);
//   - otherwise                         → `unlink(target_path)`.
// ENOENT (already gone) counts as `{ deleted: true }` — the desired end state
// is reached. EACCES/EPERM (or any other unlink error) surface an error
// envelope the failure toast renders inline. The disposition (kept vs deleted)
// is NOT read from the DB — a delete-disposition row whose file the download
// handler already unlinked simply hits the ENOENT-as-success path.

import { unlink as nodeUnlink } from "node:fs/promises";

import type Database from "better-sqlite3";

import { FilesErrorTag } from "@ft5/ipc-contracts";

import type { CommandHandler } from "../ipc/server.js";

/** Minimal filesystem port — injected in tests, defaults to node's fs. */
export interface DeletePartialFs {
  unlink(path: string): Promise<void>;
}

export interface DeletePartialDeps {
  readonly db: Database.Database;
  /** Defaults to `node:fs/promises` unlink; overridable for tests. */
  readonly fs?: DeletePartialFs;
}

interface DownloadRow {
  readonly target_path: string;
  readonly status: string;
}

function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === code
  );
}

export function makeDeletePartialHandler(
  deps: DeletePartialDeps,
): CommandHandler<"downloads:delete-partial"> {
  const fs: DeletePartialFs = deps.fs ?? { unlink: (p) => nodeUnlink(p) };
  return async (params) => {
    const row = deps.db
      .prepare(
        `SELECT target_path, status FROM downloads WHERE download_job_id = ?`,
      )
      .get(params.downloadJobId) as DownloadRow | undefined;

    // Not recorded → nothing we wrote to delete. No-op success.
    if (row === undefined) {
      return { ok: true, result: { deleted: false } };
    }

    // Never unlink a file that is still being actively written.
    if (row.status === "in-flight") {
      return {
        ok: false,
        error: {
          tag: FilesErrorTag.Other,
          message:
            "download is still in flight; cannot delete the partial file",
          retryable: false,
        },
      };
    }

    try {
      await fs.unlink(row.target_path);
      return { ok: true, result: { deleted: true } };
    } catch (err) {
      // Already gone is the desired end state.
      if (isErrno(err, "ENOENT")) {
        return { ok: true, result: { deleted: true } };
      }
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: {
          tag: FilesErrorTag.Other,
          message: `could not delete the partial file: ${reason}`,
          retryable: false,
        },
      };
    }
  };
}
