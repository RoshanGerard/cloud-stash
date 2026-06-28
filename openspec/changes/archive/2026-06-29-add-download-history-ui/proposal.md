# Proposal: Download-history management controls (retention + manual clear)

> Promoted from a stub (spawned during `migrate-download-registry-to-sqlite`
> brainstorming on 2026-06-28). Open questions resolved in a brainstorming
> session the same day; decisions captured in `design.md`.

## Why

`migrate-download-registry-to-sqlite` makes the fs-sync download history
durable (a `downloads` table recording completed / failed / cancelled /
interrupted downloads) but deliberately ships **no** way to manage that
data — no retention policy, no manual clear, no UI. Without management the
table grows unbounded and the user has no control over what is kept. This
change adds the management controls the parent deferred.

## What Changes

- **Configurable auto-prune.** Extend `ServiceConfig` (`config.json`) with
  an optional `downloadHistory: { autoPrune: boolean; retentionDays: 30 |
  90 | 180 | 365 }` (additive at the unchanged config `schemaVersion: 1`;
  absent/malformed ⇒ default `{ autoPrune: true, retentionDays: 90 }`). A
  service-side scheduler prunes terminal history older than the window on
  start + every 24 h **only when** `autoPrune` is enabled.
- **Manual clear.** New `downloads:clear-history` IPC command with optional
  `{ status?, olderThanMs? }` filters (no filter ⇒ all terminal rows),
  returning `{ deleted: number }`. Never deletes in-flight rows or on-disk
  files.
- **New wire type.** `DownloadTerminalStatus` (`completed | failed |
  cancelled | interrupted`) is promoted to `@ft5/ipc-contracts` — the first
  time the (otherwise DB-only) download statuses cross the wire.
- **Desktop bridge.** Expose `sync:get-config` / `sync:set-config`
  (currently unbridged — "for a future settings UI") and
  `downloads:clear-history` to the renderer.
- **Settings controls** (Settings → Downloads): an auto-prune Switch, a
  retention-window selector, and a filtered "Clear download history" control
  with a destructive-confirm dialog.

Scope is **management controls only** — there is NO browsable history-list
view; that is deferred to a future stub (which will also subsume
`add-failed-download-cleanup-affordance` Phase 2's kept-partials list).

## Dependencies

- **BLOCKED ON `migrate-download-registry-to-sqlite` (currently UNMERGED,
  at its review gate and still mutable).** That change creates the
  `downloads` table and the five-status model this change reads, prunes,
  and clears.
- **Apply/merge order:** `migrate-download-registry-to-sqlite` FIRST, then
  this. "Apply-ready" (artifacts validate green) ≠ "appliable":
  `/opsx:apply` off `master` before migrate merges would fail — the TDD
  tests reference a schema that does not exist yet. This change must stack
  on migrate's branch OR wait for migrate to merge.
- **Shared file:** both changes edit
  `services/fs-sync/src/main/bootstrap.ts` (migrate adds
  `sweepInterruptedDownloads` after the PID guard; this adds the
  config-gated prune AFTER that sweep) — expect a small merge there.
- This change **references** migrate's contracts (the `downloads` table,
  its `status` column); it does not restate them, to minimize re-sync if
  migrate shifts in review.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `fs-sync-service`: the IPC command surface gains `downloads:clear-history`;
  the `sync:get-config`/`sync:set-config` requirement gains a renderer
  consumer + the `downloadHistory` config and a read-modify-write
  preservation invariant; new requirements cover the config-gated auto-prune,
  the clear-history command, and the `DownloadTerminalStatus` wire type.
- `file-explorer`: new requirements cover the Settings → Downloads
  retention/clear controls, the renderer read-modify-write config helper,
  and the desktop bridge that exposes config get/set + `clear-history` to
  the renderer.

## Impact

- **Contract (`@ft5/ipc-contracts`):** `ServiceConfig` gains optional
  `downloadHistory`; new `downloads:clear-history` command type; new
  `DownloadTerminalStatus` type. **This is a wire-contract addition**
  (additive, non-breaking).
- **Service (`services/fs-sync`):** `pruneDownloadHistory` + config-gated
  scheduler in `src/downloads/` + `bootstrap.ts`; `downloads:clear-history`
  handler; `ServiceConfigStore` + set-config validation for `downloadHistory`.
- **Desktop (`apps/desktop/src/main`, `src/preload`):** bridge
  `sync:get-config` / `sync:set-config` / `downloads:clear-history` to the
  renderer (first renderer consumer of config get/set).
- **Renderer (`apps/desktop/src/renderer`):** Settings → Downloads controls
  (`settings-dialog.tsx`); a tested read-modify-write config helper.
- **No change** to the `downloads` table schema itself (owned by migrate);
  this change only reads/prunes/clears it.
