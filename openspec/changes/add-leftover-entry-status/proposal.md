## Why

The "Review leftover files" dialog shipped in `add-leftover-download-cleanup`
labels **every** leftover row "Download failed" — including files the user
deliberately **cancelled** and downloads that were **interrupted**. That is
factually wrong, and it is wrong in the one place where the user is deciding
whether a file is safe to delete.

The cause is a wire gap, not a rendering bug. `downloads:list-leftover` filters
to KEEP-eligible terminal rows (`failed` / `cancelled` / `interrupted`) but never
projects which one a row actually is. The renderer therefore has nothing to
branch on: a cancelled row's `failureTag` / `failureMessage` are both `null`, so
`reasonLine` falls through its `??` chain to the hard-coded "Download failed"
string. The disposition already exists service-side — it is used in the query's
`WHERE` clause — it just never reaches the client.

## What Changes

- Surface the terminal disposition on the wire: `LeftoverEntry` gains a required
  `status` field so each leftover row can state accurately why it is there.
- Introduce `LeftoverStatus`, derived as `Exclude<DownloadTerminalStatus,
  "completed">`, reusing the existing wire vocabulary rather than minting a
  parallel enum. Deriving (rather than reusing `DownloadTerminalStatus` whole)
  keeps the type exactly as narrow as reality: a leftover row can never be
  `completed`, so the renderer gets an exhaustive three-case match with no
  unreachable branch.
- Rewrite the dialog's per-row reason line to lead with the disposition
  (`<status> · [detail] · <when>`), giving every row a uniform, scannable
  shape. The generic "Download failed" fallback is removed outright — with
  `status` required, no row can be unlabelled.
- Correct the dialog's own description, which likewise claims the list holds
  files "left on disk by past **failed** downloads" while in fact it includes
  cancelled and interrupted ones.
- Additive, NOT breaking: one field is added, none removed, no existing field's
  type narrowed, and no request shape changes. Delete paths are untouched.

## Capabilities

### New Capabilities

None. Both affected capabilities already exist.

### Modified Capabilities

- `fs-sync-service`: MODIFY the `downloads:list-leftover` RPC requirement so the
  documented `LeftoverEntry` field list includes `status`, and define its
  vocabulary as the three KEEP-eligible terminal statuses.
- `file-explorer`: MODIFY the Review-leftover-files affordance requirement so
  the per-row reason is required to reflect the row's actual terminal
  disposition, rather than presenting every row as a failure.

## Impact

- `packages/ipc-contracts` — `LeftoverEntry` and the new `LeftoverStatus` in
  `sync-service/commands.ts`, threaded through the existing export chain
  (`sync-service/index.ts` → `sync-service-desktop/requests.ts` →
  `sync-service-desktop/index.ts`).
- `services/fs-sync` — `commands/downloads-list-leftover.ts`: add `status` to the
  `SELECT` column list (today it appears only in the `WHERE`) and project it onto
  the entry. Filtering, ordering, the `stat`-skip behaviour, and the
  never-throws contract are unchanged.
- `apps/desktop` — `features/settings/leftover-files-dialog.tsx`: `reasonLine`
  composition and the dialog description copy. Additionally, the status→label
  strings are lifted into one shared lookup that both this dialog and the
  existing `clear-history-dialog.tsx` read, so the two adjacent Settings dialogs
  cannot drift into naming the same state differently. This is the only existing
  working file the change modifies rather than extends.
- Tests at all four existing layers for this RPC: the contract type test, the
  service handler test, the main-process IPC test, and the renderer dialog test.
- No dependency changes. No database schema change — the `downloads.status`
  column already exists and is already read by this query.
