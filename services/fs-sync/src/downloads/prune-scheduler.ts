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
// cleared on `stop()`. Never deletes `in-flight` rows and never MODIFIES
// on-disk files — the prune only READS disk state (`stat`) to retain
// KEEP-eligible aged leftovers whose partial is still present, and never
// unlinks (that is `pruneDownloadHistory`'s contract).

import type Database from "better-sqlite3";

import type { ServiceConfig } from "@cloudstash/ipc-contracts/sync-service";

import { resolveRetentionSettings } from "../config/download-history-settings.js";
import { pruneDownloadHistory, type PruneFs } from "./prune.js";

const DAY_MS = 86_400_000;

/** The auto-prune cadence: once every 24 hours. */
export const PRUNE_INTERVAL_MS = DAY_MS;

export interface PruneSchedulerDeps {
  readonly db: Database.Database;
  /** Reads the current service config (e.g. `() => configStore.getRaw()`). */
  readonly readConfig: () => Promise<ServiceConfig>;
  // Structurally matches the bootstrap `BootstrapLogger` (info(msg, fields?));
  // `| undefined` so an absent bootstrap logger threads through under
  // `exactOptionalPropertyTypes`.
  readonly logger?:
    | { info(msg: string, fields?: Record<string, unknown>): void }
    | undefined;
  /** Override the 24h cadence (tests). Defaults to {@link PRUNE_INTERVAL_MS}. */
  readonly intervalMs?: number | undefined;
  // Filesystem `stat` port threaded into `pruneDownloadHistory` so the prune
  // can retain KEEP-eligible aged rows whose partial is still on disk
  // (add-leftover-download-cleanup §5). `| undefined` so an absent arg threads
  // through under `exactOptionalPropertyTypes`; `pruneDownloadHistory` falls
  // back to `node:fs/promises` when it is undefined. Production leaves it
  // unset (bootstrap constructs the scheduler without an `fs`); tests inject a
  // hermetic port.
  readonly fs?: PruneFs | undefined;
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
    try {
      const config = await deps.readConfig();
      const settings = resolveRetentionSettings(config);
      if (!settings.autoPrune) {
        return;
      }
      const deleted = await pruneDownloadHistory(
        deps.db,
        { maxAgeMs: settings.retentionDays * DAY_MS },
        deps.fs,
      );
      if (deleted > 0) {
        deps.logger?.info("downloads-history-pruned", {
          deleted,
          retentionDays: settings.retentionDays,
        });
      }
    } catch (err) {
      // Autonomous retention must NEVER crash or destabilize the service.
      // `ServiceConfigStore.getRaw` rethrows on a malformed/unparseable
      // config.json (only ENOENT yields the default), so an unguarded read
      // would abort the boot at stage 10c (Decision 2's defensive-read intent
      // is to degrade, not crash) and a rejected 24h tick (`void runOnce()`)
      // would surface as an unhandled rejection. Degrade to "skip this cycle".
      deps.logger?.info("downloads-history-prune-skipped", {
        reason: err instanceof Error ? err.message : String(err),
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
