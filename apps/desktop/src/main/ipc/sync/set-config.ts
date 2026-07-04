// add-download-history-ui §5 — handleSyncSetConfig
//
// Wraps `SyncClient.setConfig(req)` so the renderer-facing
// `SyncSetConfigResponse` envelope is constructed at the desktop boundary. The
// service writes the config WHOLESALE, so the renderer routes through a
// read-modify-write helper that preserves `providers` + `schemaVersion`
// (add-download-history-ui Decision 7); an invalid downloadHistory is rejected
// service-side as `io-error`, mapped here to `{ ok: false, error }`.
//
// Security invariant: config ownership lives on the service. This handler
// carries the request through and wraps the reply without persisting,
// caching, or inspecting any of its content (incl. OAuth secrets in
// `providers`).

import type {
  SyncSetConfigRequest,
  SyncSetConfigResponse,
} from "@cloudstash/ipc-contracts/sync-service-desktop";
import type { SyncSetConfigError } from "@cloudstash/ipc-contracts/sync-service";

import { SyncClient, SyncCommandError } from "../../sync/client.js";
import { getSyncClient } from "../../sync/sync-client-holder.js";

export async function handleSyncSetConfig(
  req: SyncSetConfigRequest,
  client: SyncClient = getSyncClient(),
): Promise<SyncSetConfigResponse> {
  try {
    const result = await client.setConfig(req);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof SyncCommandError) {
      return { ok: false, error: err.raw as SyncSetConfigError };
    }
    throw err;
  }
}
