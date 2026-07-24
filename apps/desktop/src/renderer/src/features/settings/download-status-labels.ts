// add-leftover-entry-status (design.md Decision 6, ## Visual direction VD1) —
// the single source of truth for humanizing a terminal download status.
//
// Two dialogs in the same Settings → Downloads section render this vocabulary:
// `ClearHistoryDialog` (as filter chips, all four statuses) and
// `LeftoverFilesDialog` (as the leading segment of each row's reason line,
// only the three KEEP-eligible ones). Duplicating the strings would let two
// adjacent surfaces drift into naming the same underlying state differently —
// so they are shared, and a future rename lands in both at once.
//
// UI-layer only. The service never composes display text; it puts the raw
// `status` value on the wire and the renderer humanizes it (design.md
// Decision 1).

import type { DownloadTerminalStatus } from "@cloudstash/ipc-contracts/sync-service-desktop";

/**
 * Human-readable label per terminal download status.
 *
 * Keyed on the full `DownloadTerminalStatus`, not on the narrower
 * `LeftoverStatus`: `ClearHistoryDialog` needs `completed` too, and a total
 * `Record` over the wire vocabulary means adding a status to the union is a
 * compile error here rather than a missing label at runtime. `LeftoverStatus`
 * is a subset of these keys, so the leftover dialog can index this directly
 * with no fallback branch.
 */
export const DOWNLOAD_STATUS_LABELS: Readonly<Record<DownloadTerminalStatus, string>> = {
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};
