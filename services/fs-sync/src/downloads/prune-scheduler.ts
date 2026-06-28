// Config-gated download-history prune scheduler (add-download-history-ui §3,
// design.md Decision 4). Enforces the retention policy autonomously inside the
// detached service — even while the desktop app is closed — which is why the
// policy lives service-side in `config.json` (Decision 1), not renderer
// localStorage.
//
// On `start()` it prunes once immediately (AFTER the startup
// interrupted-sweep, so freshly-`interrupted` rows are eligible right away),
// then re-prunes every 24h. Each run RE-READS the current retention policy
// from config, so a `set-config` change takes effect on the next cycle without
// a restart; when `autoPrune` is off the run is a no-op. The interval timer is
// cleared on `stop()`. Never touches `in-flight` rows or on-disk files (that
// is `pruneDownloadHistory`'s contract).

import type Database from "better-sqlite3";

import type { ServiceConfig } from "@ft5/ipc-contracts/sync-service";

import { resolveRetentionSettings } from "../config/download-history-settings.js";
import { pruneDownloadHistory } from "./prune.js";

const DAY_MS = 86_400_000;

/** The auto-prune cadence: once every 24 hours. */
export const PRUNE_INTERVAL_MS = DAY_MS;

export interface PruneSchedulerDeps {
  readonly db: Database.Database;
  /** Reads the current service config (e.g. `() => configStore.getRaw()`). */
  readonly readConfig: () => Promise<ServiceConfig>;
  readonly logger?: { info: (msg: string, meta?: unknown) => void };
  /** Override the 24h cadence (tests). Defaults to {@link PRUNE_INTERVAL_MS}. */
  readonly intervalMs?: number;
}

export interface PruneScheduler {
  /** Prune once now, then arm the 24h interval. */
  start(): Promise<void>;
  /** Clear the interval timer — no further prune runs. Idempotent. */
  stop(): void;
}

export function createPruneScheduler(deps: PruneSchedulerDeps): PruneScheduler {
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runOnce(): Promise<void> {
    const config = await deps.readConfig();
    const settings = resolveRetentionSettings(config);
    if (!settings.autoPrune) {
      return;
    }
    const deleted = pruneDownloadHistory(deps.db, {
      maxAgeMs: settings.retentionDays * DAY_MS,
    });
    if (deleted > 0) {
      deps.logger?.info("downloads-history-pruned", {
        deleted,
        retentionDays: settings.retentionDays,
      });
    }
  }

  return {
    async start(): Promise<void> {
      await runOnce();
      timer = setInterval(() => {
        void runOnce();
      }, deps.intervalMs ?? PRUNE_INTERVAL_MS);
      // The prune timer must not, by itself, keep the service process alive.
      timer.unref?.();
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
