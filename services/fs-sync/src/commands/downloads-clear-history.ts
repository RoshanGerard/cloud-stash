// `downloads:clear-history` command handler (add-download-history-ui §4,
// design.md Decision 5). Thin wrapper around `clearDownloadHistory(db,
// filter, fs)` — deletes matching terminal `downloads` rows and returns the
// deleted count.
//
// It emits NO event/broadcast: the renderer toaster renders only in-flight
// downloads, which clear never touches, so there is nothing to invalidate
// (Decision 5). It never deletes the live `in-flight` row. Per
// add-leftover-download-cleanup §4 the SQL core also unlinks the on-disk
// partials of the KEEP-eligible rows it deletes (best-effort; completed rows'
// saved files are never touched) — the filesystem port is threaded through
// here and defaults to node's fs when omitted.

import type Database from "better-sqlite3";

import type { CommandHandler } from "../ipc/server.js";

import {
  clearDownloadHistory,
  type ClearHistoryFs,
} from "../downloads/clear-history.js";

export interface ClearDownloadHistoryDeps {
  readonly db: Database.Database;
  /** Defaults to `node:fs/promises` unlink; overridable for tests. */
  readonly fs?: ClearHistoryFs;
}

export function makeClearDownloadHistoryHandler(
  deps: ClearDownloadHistoryDeps,
): CommandHandler<"downloads:clear-history"> {
  return async (params) => {
    const deleted = await clearDownloadHistory(deps.db, params.filter, deps.fs);
    return { ok: true, result: { deleted } };
  };
}
