// add-download-history-ui §5 — handleClearDownloadHistory
//
// Near-identity proxy over `SyncClient.clearDownloadHistory` (→ service command
// `downloads:clear-history`). Deletes terminal `downloads` rows by the optional
// status/age filter and returns the `{ deleted }` count the Settings → Downloads
// "Clear download history" control reports via a toast.
//
// The service handler is effectively infallible (always `{ deleted }`) and
// emits no event, so this proxy passes the flat result through verbatim;
// transport-level failures re-throw and surface to the renderer as an IPC
// invoke rejection. Never touches in-flight rows or on-disk files.

import type { SyncClearDownloadHistoryRequest, SyncClearDownloadHistoryResponse } from "@ft5/ipc-contracts/sync-service-desktop";

import type { SyncClient } from "../../sync/client.js";
import { getSyncClient } from "../../sync/sync-client-holder.js";

export async function handleClearDownloadHistory(
  req: SyncClearDownloadHistoryRequest,
  client: SyncClient = getSyncClient(),
): Promise<SyncClearDownloadHistoryResponse> {
  return await client.clearDownloadHistory(req);
}
