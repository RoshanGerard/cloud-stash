// `downloads:clear-history` command handler (add-download-history-ui §4,
// design.md Decision 5). Thin wrapper around `clearDownloadHistory(db,
// filter)` — deletes matching terminal `downloads` rows and returns the
// deleted count.
//
// It emits NO event/broadcast: the renderer toaster renders only in-flight
// downloads, which clear never touches, so there is nothing to invalidate
// (Decision 5). It never deletes the live `in-flight` row and never touches
// on-disk files (the SQL core's contract).

import type Database from "better-sqlite3";

import type { CommandHandler } from "../ipc/server.js";

import { clearDownloadHistory } from "../downloads/clear-history.js";

export interface ClearDownloadHistoryDeps {
  readonly db: Database.Database;
}

export function makeClearDownloadHistoryHandler(
  deps: ClearDownloadHistoryDeps,
): CommandHandler<"downloads:clear-history"> {
  return async (params) => {
    const deleted = clearDownloadHistory(deps.db, params.filter);
    return { ok: true, result: { deleted } };
  };
}
