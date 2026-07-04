// add-leftover-download-cleanup §2.2 — handleListLeftover
//
// Near-identity proxy over `SyncClient.listLeftover` (→ service command
// `downloads:list-leftover`). Returns the flat `{ entries }` snapshot of
// KEEP-eligible terminal downloads whose partial file still exists on disk
// (the service stats each `target_path`; rows whose file is gone are
// excluded — the renderer has no filesystem access). The Settings →
// "Review leftover files" affordance reads it on open; per-row cleanup
// reuses `downloads:delete-partial` UNCHANGED.
//
// The renderer-facing `SyncListLeftoverRequest` is `void`; the wire params
// shape is `Record<string, never>`, so the handler passes an empty object
// through (mirrors `handleSyncGetStatus`). Unlike get-status there is no
// field projection — the wire result `{ entries }` IS the renderer-facing
// `SyncListLeftoverResponse`, so it passes through verbatim.
//
// INFALLIBLE read at the service boundary — every service-side failure
// re-throws so the IPC layer surfaces it as an invoke rejection; there is
// no `{ result } | { error }` union on this call.

import type {
  SyncListLeftoverRequest,
  SyncListLeftoverResponse,
} from "@cloudstash/ipc-contracts/sync-service-desktop";

import type { SyncClient } from "../../sync/client.js";
import { getSyncClient } from "../../sync/sync-client-holder.js";

export async function handleListLeftover(
  req: SyncListLeftoverRequest,
  client: SyncClient = getSyncClient(),
): Promise<SyncListLeftoverResponse> {
  // `req` is typed `void` on the renderer contract; reference it so the
  // parameter isn't flagged as unused while preserving the slot for
  // symmetry with the other sync handlers.
  void req;
  return await client.listLeftover({});
}
