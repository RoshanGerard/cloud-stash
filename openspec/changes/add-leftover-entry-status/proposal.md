> **STATUS: STUB — not yet designed.** Follow-up surfaced by the advisor during
> `add-leftover-download-cleanup` (Phase 2, merged 2026-07-04). Resolve the open
> questions below via `superpowers:brainstorming` before `/opsx:propose`. No
> `design.md`, spec delta, or `tasks.md` yet — this file captures intent only.

## Why

The `downloads:list-leftover` "Review leftover files" dialog shipped in
`add-leftover-download-cleanup` renders **"Download failed"** as the reason for
EVERY leftover, even a user-**cancelled** or **interrupted** one. Cause: the
`LeftoverEntry` wire shape carries no terminal `status`, and a cancelled row's
`failureTag` / `failureMessage` are typically `null`, so the renderer's
`reasonLine` falls through to the generic "Download failed" label — which is
factually wrong for a cancel (the list explicitly includes `cancelled` and
`interrupted` rows, not just `failed`).

## What Changes

- Surface the terminal disposition to the renderer so each leftover row shows an
  accurate reason (e.g. "Cancelled", "Interrupted", or the specific failure).
  The list already filters to `failed` / `cancelled` / `interrupted`, so the
  information exists service-side — it just isn't on the wire.
- Additive (NOT breaking): a new field on `LeftoverEntry` + a small renderer
  `reasonLine` change. No change to the delete paths.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `fs-sync-service`: MODIFY the `downloads:list-leftover` RPC / `LeftoverEntry`
  shape to carry the terminal disposition (see Open Questions for exact form).
  The handler already selects only KEEP-eligible rows — it just needs to project
  the `status` column it currently reads for filtering.
- `file-explorer`: MODIFY the Review-leftover-files dialog's `reasonLine` so a
  cancelled / interrupted row reads accurately instead of "Download failed".

## Open Questions (resolve in brainstorming)

1. **Field shape:** add the raw `status` enum (`failed | cancelled | interrupted`)
   to `LeftoverEntry` and let the renderer humanize it, OR add a pre-computed
   `reason` string the service composes? (Raw `status` keeps the wire minimal and
   matches how `DownloadTerminalStatus` is already a wire type; a `reason` string
   centralizes copy but bakes presentation into the service.)
2. **`reasonLine` composition:** how do `status` + `failureMessage` combine — e.g.
   "Cancelled · 3 days ago" for a cancel (no failure detail) vs
   "Failed · ran out of retries · 3 days ago" for a failure with a message?
3. Any existing wire vocabulary to reuse (`DownloadTerminalStatus` from
   `@ft5/ipc-contracts/sync-service`) rather than a new enum?

## Impact

- `packages/ipc-contracts` — `LeftoverEntry` (+ its desktop re-export).
- `services/fs-sync` — `downloads-list-leftover.ts` (project the new field; the
  SELECT already needs `status` for the WHERE filter).
- `apps/desktop/src/renderer/.../leftover-files-dialog.tsx` — `reasonLine`.
- Tests across the same four layers.
