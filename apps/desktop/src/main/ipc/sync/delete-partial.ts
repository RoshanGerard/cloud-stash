// add-failed-download-cleanup-affordance §4 — handleDeletePartial
//
// Near-identity proxy over `SyncClient.deletePartial` (→ service command
// `downloads:delete-partial`). Deletes the partial file recorded on a
// terminal `downloads` row, keyed by `downloadJobId` (the path is resolved
// service-side — never passed over the renderer boundary). The download
// failure toast's "Delete partial" action invokes it.
//
// Passes the flat `{ deleted }` result through verbatim on success; a
// meaningful failure (in-flight refusal, EACCES/EPERM) or a transport-level
// failure re-throws and surfaces to the renderer as an IPC invoke rejection,
// which the toast renders as an inline error.

import type {
  SyncDeletePartialRequest,
  SyncDeletePartialResponse,
} from "@cloudstash/ipc-contracts/sync-service-desktop";

import type { SyncClient } from "../../sync/client.js";
import { getSyncClient } from "../../sync/sync-client-holder.js";

export async function handleDeletePartial(
  req: SyncDeletePartialRequest,
  client: SyncClient = getSyncClient(),
): Promise<SyncDeletePartialResponse> {
  return await client.deletePartial(req);
}
