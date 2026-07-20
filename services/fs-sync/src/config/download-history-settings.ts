// Download-history retention settings — the defensive read site for the
// optional `ServiceConfig.downloadHistory` field (add-download-history-ui,
// design.md Decision 2).
//
// `ServiceConfigStore.read`'s `as ServiceConfig` cast does NOT validate the
// `downloadHistory` shape, so every consumer (the auto-prune scheduler and
// the `sync:set-config` validation path) routes through this module:
//   - `resolveRetentionSettings` returns the stored value when valid and the
//     default `{ autoPrune: true, retentionDays: 90 }` when the field is
//     absent OR malformed (wrong shape / off-set `retentionDays` /
//     non-boolean `autoPrune`).
//   - `isValidDownloadHistory` is the shared predicate `set-config` reuses to
//     reject an out-of-contract write.

import type { ServiceConfig } from "@cloudstash/ipc-contracts/sync-service";

export interface RetentionSettings {
  readonly autoPrune: boolean;
  readonly retentionDays: 30 | 90 | 180 | 365;
}

/** The four valid retention windows, in days. */
export const RETENTION_DAYS_PRESETS = [30, 90, 180, 365] as const;

/** Applied whenever `downloadHistory` is absent or malformed. */
export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  autoPrune: true,
  retentionDays: 90,
};

/**
 * Runtime shape guard for a `downloadHistory` value. Returns `true` only when
 * `autoPrune` is a boolean and `retentionDays` is one of the four presets.
 * Used both to validate an inbound `set-config` write and to decide whether
 * the resolver can trust a stored value.
 */
export function isValidDownloadHistory(value: unknown): value is RetentionSettings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { autoPrune?: unknown; retentionDays?: unknown };
  if (typeof candidate.autoPrune !== "boolean") {
    return false;
  }
  return (
    typeof candidate.retentionDays === "number" &&
    (RETENTION_DAYS_PRESETS as readonly number[]).includes(candidate.retentionDays)
  );
}

/**
 * Resolve the effective retention settings from a (possibly hand-edited)
 * service config, applying {@link DEFAULT_RETENTION_SETTINGS} when
 * `downloadHistory` is absent or fails {@link isValidDownloadHistory}.
 */
export function resolveRetentionSettings(config: ServiceConfig): RetentionSettings {
  const candidate: unknown = config.downloadHistory;
  if (isValidDownloadHistory(candidate)) {
    return {
      autoPrune: candidate.autoPrune,
      retentionDays: candidate.retentionDays,
    };
  }
  return DEFAULT_RETENTION_SETTINGS;
}
