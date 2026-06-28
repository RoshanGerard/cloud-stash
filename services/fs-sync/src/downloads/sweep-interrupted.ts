// Startup reconciliation for the durable `downloads` table. Runs AFTER the
// single-instance PID guard is acquired (bootstrap stage 4+) — only the
// process that won single-instance enforcement ever sweeps, so this can
// never terminalize another live process's in-flight rows.
//
// Any row still `status='in-flight'` at startup is necessarily orphaned by a
// prior process (this process has started no downloads yet): a crash, kill,
// OS shutdown, or debug-build relaunch. Transition each to the terminal
// `interrupted` status, stamping `ended_at`/`updated_at`. Terminal rows
// (completed/failed/cancelled/interrupted) are left untouched by the WHERE
// clause.
//
// Bookkeeping only — NEVER touches files on disk. Resuming a stranded partial
// after a service crash is replay, which is out of scope (excluded by
// `add-download-resilience` on the architectural-boundary argument).
//
// Spec: openspec/changes/migrate-download-registry-to-sqlite/design.md
// "Decision 5". Modeled on the `jobs`-table `recoverRunningJobs(db)`.

import type Database from "better-sqlite3";

/**
 * Terminalizes every `in-flight` row to `interrupted`. Returns the
 * `download_job_id`s that were swept (empty when none were in-flight) — the
 * caller logs the count. Synchronous (better-sqlite3); the SELECT-then-UPDATE
 * pair runs on the single Node thread with no interleaving.
 */
export function sweepInterruptedDownloads(
  db: Database.Database,
): ReadonlyArray<string> {
  const rows = db
    .prepare(
      `SELECT download_job_id FROM downloads WHERE status = 'in-flight'`,
    )
    .all() as Array<{ download_job_id: string }>;
  if (rows.length === 0) return [];

  const now = Date.now();
  db.prepare(
    `UPDATE downloads
        SET status = 'interrupted',
            ended_at = ?,
            updated_at = ?
      WHERE status = 'in-flight'`,
  ).run(now, now);

  return rows.map((r) => r.download_job_id);
}
