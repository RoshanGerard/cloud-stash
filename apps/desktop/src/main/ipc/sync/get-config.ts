// add-download-history-ui §5 — handleSyncGetConfig
//
// Wraps `SyncClient.getConfig()` so the renderer-facing `SyncGetConfigResponse`
// envelope (`{ ok: true, result } | { ok: false, error }`) is constructed at
// the desktop boundary (mirroring `handleSyncAuthenticateStart`). This is the
// FIRST renderer exposure of `sync:get-config` (design.md Decision 8) — the
// Settings → Downloads retention controls read the config through it.
//
// Security invariant: credential/config ownership lives on the service. This
// handler carries the request through and wraps the reply without persisting,
// caching, or inspecting any of its content.

import type { SyncGetConfigResponse } from "@cloudstash/ipc-contracts/sync-service-desktop";
import type { SyncGetConfigError } from "@cloudstash/ipc-contracts/sync-service";

import { SyncClient, SyncCommandError } from "../../sync/client.js";
import { getSyncClient } from "../../sync/sync-client-holder.js";

export async function handleSyncGetConfig(
  client: SyncClient = getSyncClient(),
): Promise<SyncGetConfigResponse> {
  try {
    const result = await client.getConfig({});
    return { ok: true, result };
  } catch (err) {
    if (err instanceof SyncCommandError) {
      return { ok: false, error: err.raw as SyncGetConfigError };
    }
    throw err;
  }
}
