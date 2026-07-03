# Proposal: UI affordance to delete a partial file left after a failed download

**Status**: Phase 1 (of 2). Spawned during `add-download-resilience`
brainstorming on 2026-04-30; artifacts regenerated 2026-07-03 after
code-grounding proved the original stub substantially stale.

## Why

`add-download-resilience` KEEPS the partial file on disk for most
terminal download failures (environmental-budget / wall-time /
`auth-revoked` / user-cancel / byte-count-mismatch), to preserve the
user's bandwidth investment. But a kept partial has no recovery
affordance today:

- The failure toast shows only "Retry" — and a Retry never resumes from
  the kept partial anyway. Because `finalize` deletes the in-memory
  registry entry, a user-initiated Retry re-runs the destination-conflict
  gate, finds the partial on disk, and returns `tag: "conflict"` — which
  pops the ConflictResolutionDialog (overwrite / keep-both / cancel).
  So the kept partial's real effect is to **impose a conflict prompt on
  the next download of that file**, not to enable resume.
- A 240 MB partial at `~/Downloads/seed.mp4` is indistinguishable from a
  complete download; once the toast is dismissed there is no trail.

This change gives the user a one-click way to discard the orphan directly
from the failure toast: reclaim the disk and clear the conflict friction.
Deleting is safe — the source is still on the provider and Retry
re-downloads from byte 0 regardless — so it is a low-stakes, one-click
action.

## What Changes

- Add an OPTIONAL `partialKept?: boolean` field to the `download-failed`
  IPC event, computed service-side at emit time from the disposition the
  handler already knows. Optional + default-false keeps it backward
  compatible (hydrated / older-service events render no button).
- Add a new IPC command `downloads:delete-partial { downloadJobId } →
  { deleted: boolean }` that deletes the recorded partial file for a
  terminal download. It is keyed on `downloadJobId` (no filesystem path
  crosses IPC); the handler resolves `target_path` from the durable
  `downloads` SQLite table and `unlink`s it.
- The download failure toast renders a one-click **"Delete partial"**
  action beside "Retry" when `partialKept` is true. Success dismisses the
  toast; a permission error surfaces inline.
- **Non-breaking**: no existing command / event field is removed or
  changed in meaning; the new event field is additive and optional.

Out of scope (Phase 2 / follow-up stub):

- Aggregate cleanup of orphaned partials from past sessions in the
  Settings → Downloads panel. That needs a net-new `downloads:list-history`
  read command and a new list UI, and only covers failures the user did
  not witness live.
- Auto-cleanup on app launch; renaming partials to `.part` / `.crdownload`;
  resume-from-partial semantics; telemetry (no pipeline exists in the app).

## Capabilities

### New Capabilities

- None. This change extends two existing capabilities.

### Modified Capabilities

- `fs-sync-service`: adds the `downloads:delete-partial` command to the
  IPC command surface, adds the `partialKept` field to the `download-failed`
  event payload, and specifies the delete-partial handler's behavior
  (recorded + terminal guard, ENOENT-as-success, permission-error envelope).
- `file-explorer`: the download failure toast gains a one-click
  "Delete partial" action, gated on `partialKept`, wired through all four
  layers to the new command.

## Impact

- **Wire contract** (`packages/ipc-contracts`): `DownloadFailedPayload`
  gains `partialKept?: boolean`; a new `downloads:delete-partial`
  request/response pair in the sync-service command map.
- **Service** (`services/fs-sync`): new `downloads/delete-partial.ts`
  handler + dispatcher registration (wired like `downloads:clear-history`
  — needs `deps.db` + an fs `unlink`, not the engine); `files-download.ts`
  emit sites set `partialKept`.
- **Desktop main + preload**: new IPC bridge + `window.api` binding for
  the command.
- **Renderer** (`apps/desktop/.../file-explorer`): `download-job-toast.ts`
  threads `partialKept` and renders the conditional "Delete partial"
  action.
- No new runtime dependencies. No DB schema change (reuses the existing
  `downloads` table's `target_path` / `status`).
