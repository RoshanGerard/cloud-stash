-- Adds the durable `downloads` table (design.md D6 — schema version 2).
-- Forward-only; applied once on next service start and recorded in
-- `schema_migrations`. Idempotent via `IF NOT EXISTS` guards.

CREATE TABLE IF NOT EXISTS `downloads` (
  `download_job_id` TEXT PRIMARY KEY,
  `datasource_id` TEXT NOT NULL,
  `source_path` TEXT NOT NULL,
  `target_path` TEXT NOT NULL,
  `bytes_downloaded` INTEGER NOT NULL DEFAULT 0,
  `content_length` INTEGER,
  `status` TEXT NOT NULL
    CHECK (`status` IN (
      'in-flight', 'completed', 'failed', 'cancelled', 'interrupted'
    )),
  `failure_tag` TEXT,
  `failure_message` TEXT,
  `started_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `ended_at` INTEGER
);

CREATE INDEX IF NOT EXISTS `downloads_status_idx` ON `downloads` (`status`);
CREATE INDEX IF NOT EXISTS `downloads_started_at_idx`
  ON `downloads` (`started_at`);
