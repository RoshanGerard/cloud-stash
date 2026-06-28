// Renderer read-modify-write helper for the download-history retention config
// (add-download-history-ui §6, design.md Decision 7).
//
// The service persists `downloadHistory` inside `config.json` (Decision 1: the
// service prunes autonomously while the app is closed, so the policy must live
// service-side, not in renderer localStorage like the other Downloads
// settings). `sync:set-config` overwrites that file WHOLESALE, so a partial
// update MUST be read-modify-write: fetch the latest config, merge ONLY
// `downloadHistory`, and write the whole thing back — preserving
// `schemaVersion` and the existing `providers` (the OAuth app secrets a naive
// `{ schemaVersion: 1, providers: {}, downloadHistory }` write would wipe).

import type {
  ServiceConfig,
  SyncSetConfigResponse,
} from "@ft5/ipc-contracts/sync-service-desktop";

export interface DownloadHistorySettings {
  readonly autoPrune: boolean;
  readonly retentionDays: 30 | 90 | 180 | 365;
}

/** Applied whenever `downloadHistory` is absent or malformed (matches the
 *  service-side default in `download-history-settings.ts`). */
export const DOWNLOAD_HISTORY_DEFAULT: DownloadHistorySettings = {
  autoPrune: true,
  retentionDays: 90,
};

export const RETENTION_DAY_OPTIONS = [30, 90, 180, 365] as const;

const EMPTY_CONFIG: ServiceConfig = { schemaVersion: 1, providers: {} };

/**
 * Defensive read of the retention settings from a (possibly hand-edited)
 * config — mirrors the service-side `resolveRetentionSettings` so the UI and
 * the prune scheduler agree on what "absent/malformed ⇒ default" means.
 */
function resolveSettings(config: ServiceConfig): DownloadHistorySettings {
  const candidate: unknown = config.downloadHistory;
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    typeof (candidate as { autoPrune?: unknown }).autoPrune === "boolean" &&
    typeof (candidate as { retentionDays?: unknown }).retentionDays ===
      "number" &&
    (RETENTION_DAY_OPTIONS as readonly number[]).includes(
      (candidate as { retentionDays: number }).retentionDays,
    )
  ) {
    return {
      autoPrune: (candidate as DownloadHistorySettings).autoPrune,
      retentionDays: (candidate as DownloadHistorySettings).retentionDays,
    };
  }
  return DOWNLOAD_HISTORY_DEFAULT;
}

/** Read the current download-history retention settings (defensive). */
export async function readDownloadHistorySettings(): Promise<DownloadHistorySettings> {
  const res = await window.api.sync.getConfig();
  if (!res.ok) {
    return DOWNLOAD_HISTORY_DEFAULT;
  }
  return resolveSettings(res.result.config);
}

/**
 * Read-modify-write a partial download-history change (CRITICAL). Fetches the
 * LATEST config immediately before writing (concurrent-safe), merges only the
 * patched `downloadHistory` fields onto the current settings, and preserves
 * `schemaVersion` + `providers` + any other top-level config fields. Returns
 * the `set-config` response so callers can surface an `io-error`.
 */
export async function writeDownloadHistorySettings(
  patch: Partial<DownloadHistorySettings>,
): Promise<SyncSetConfigResponse> {
  const res = await window.api.sync.getConfig();
  const current: ServiceConfig = res.ok ? res.result.config : EMPTY_CONFIG;
  const currentSettings = resolveSettings(current);
  const merged: ServiceConfig = {
    ...current,
    schemaVersion: 1,
    downloadHistory: { ...currentSettings, ...patch },
  };
  return window.api.sync.setConfig({ config: merged });
}
