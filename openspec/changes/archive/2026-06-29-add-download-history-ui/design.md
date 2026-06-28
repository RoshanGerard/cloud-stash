## Context

`migrate-download-registry-to-sqlite` makes the fs-sync download history
durable: a `downloads` table (`download_job_id` PK; `status ∈ in-flight |
completed | failed | cancelled | interrupted`; `ended_at`, `started_at`,
`bytes_downloaded`, `failure_tag`, …) is written through the
`DownloadRegistry`, and a startup sweep marks crash-orphaned rows
`interrupted`. That change deliberately stops at durability — no retention,
no clear, no UI.

The service already exposes config via `ServiceConfig`
(`packages/ipc-contracts/src/sync-service/commands.ts:344`,
`{ schemaVersion: 1, providers }`) persisted to `~/ft5/sync_app/config.json`
through `ServiceConfigStore` and the `sync:get-config` / `sync:set-config`
commands. Those commands are wired at the desktop↔service channel map
(`sync-service-desktop/channels.ts:52`) but **not** bridged to the renderer
(the spec says "the renderer SHALL NOT call these — they exist for a future
settings UI"). The renderer's existing download settings (default folder,
always-ask, Explorer page-size) live in **localStorage**, not service
config. The `SettingsDialog` Downloads section
(`apps/desktop/src/renderer/src/features/settings/settings-dialog.tsx`;
spec `file-explorer` "Settings dialog includes a Downloads section") is the
natural home for the new controls, and the Explorer page-size
`DropdownMenuRadioGroup` is the pattern to mirror for the window selector.

## Dependencies

- **Hard dependency on `migrate-download-registry-to-sqlite` (UNMERGED, at
  its review gate, still mutable).** This change reads/prunes/clears the
  `downloads` table that change introduces.
- **Apply/merge order:** migrate FIRST, then this. Artifacts can validate
  green now ("apply-ready"), but `/opsx:apply` is not viable off `master`
  until migrate merges — the TDD tests reference a schema that does not yet
  exist. Stack this branch on migrate's, or wait for migrate.
- **Shared edit:** `services/fs-sync/src/main/bootstrap.ts` — migrate adds
  `sweepInterruptedDownloads` after the PID guard; this adds the config-gated
  prune AFTER the sweep. Expect a small merge.
- This design **references** migrate's `downloads` table + `status` column
  rather than restating them, so it does not drift if migrate is revised in
  review.

## Goals / Non-Goals

**Goals:**

- User-configurable retention: an auto-prune on/off toggle + a selectable
  window, enforced service-side so it works while the app is closed.
- A manual clear that honors the full backend filter contract (all /
  by-status / by-age) end-to-end through the UI.
- Make the durable data manageable without yet building a browsable
  history list.

**Non-Goals:**

- **Browsable history-list view** (a panel listing past downloads).
  Deferred to a future stub that will also subsume
  `add-failed-download-cleanup-affordance` Phase 2's kept-partials list.
- **Deleting partial files on disk.** Clear/prune remove *records* only;
  on-disk files are never touched (file cleanup is the cleanup-affordance
  stub's job).
- **Download replay/resume.** Out of scope (migrate's boundary).
- **Telemetry.** No analytics pipeline exists in the app; none added.

## Decisions

### Decision 1 — Config lives service-side in `ServiceConfig` (not renderer localStorage)

`downloadHistory` config goes in `config.json` via `sync:get-config` /
`sync:set-config`, unlike the other Downloads settings (localStorage).

**Rationale.** The prune runs in the **detached service** on a 24 h timer
that fires even when the desktop app is closed, so the service must own the
policy — it cannot read renderer localStorage. This asymmetry is forced,
not a style choice.

### Decision 2 — `downloadHistory` is additive at config `schemaVersion: 1`

Add optional `downloadHistory?: { autoPrune: boolean; retentionDays: 30 |
90 | 180 | 365 }` to `ServiceConfig`. The config `schemaVersion` stays `1`
(an optional field is backward-compatible; `ServiceConfigStore.read`
validates only `schemaVersion === 1` and `providers` shape, so old files
without the field parse fine). This is **distinct** from migrate's `sync.db`
`CURRENT_SCHEMA_VERSION` bump — two different schemas.

**Defensive read.** Absent OR malformed `downloadHistory` ⇒ the default
`{ autoPrune: true, retentionDays: 90 }`. The `as ServiceConfig` cast in
`ServiceConfigStore.read` does not validate the field's shape, so the read
site (prune scheduler + set-config validation) applies the default and
rejects an out-of-set `retentionDays` (must be one of 30/90/180/365) or a
non-boolean `autoPrune`.

### Decision 3 — `retentionDays` is a fixed preset union (30 | 90 | 180 | 365)

A typed union, surfaced via the same `DropdownMenuRadioGroup` pattern as the
Explorer page-size control. Type-safe, trivially validated service-side,
visually consistent. Default 90.

**Alternative — free positive integer.** Rejected: looser validation, harder
to assert in the spec, no real user need for arbitrary windows.

### Decision 4 — Config-gated auto-prune; the prune deferred out of migrate lands here

`pruneDownloadHistory(db, { maxAgeMs })` deletes terminal rows
(`status != 'in-flight' AND ended_at < now - maxAgeMs`). A scheduler reads
config on service start (after migrate's interrupted-sweep) and every 24 h:
when `autoPrune` is enabled, prune with `maxAgeMs = retentionDays *
86_400_000`; otherwise skip. The 24 h timer is cleared on shutdown. Prune
never touches in-flight rows or on-disk files.

Filtering is on `ended_at`, which migrate does not index — accepted: the
table is tiny (bounded by retention itself), so a scan is fine; no
`ended_at` index is added.

### Decision 5 — `downloads:clear-history` honors the full filter contract; no broadcast

New command, request `{ filter?: { status?: DownloadTerminalStatus[];
olderThanMs?: number } }` (no filter ⇒ all terminal rows), response
`{ ok: true, value: { deleted: number } }`. The handler deletes matching
terminal rows; it NEVER deletes `in-flight` rows or on-disk files. It emits
**no** event/broadcast — the renderer toaster only renders in-flight
downloads, which clear never touches, so there is nothing to invalidate.

The UI surfaces the filters (all / by-status / by-age) per the user's
explicit decision — the backend chose filtered clear, so the UI honors it
end-to-end rather than collapsing to clear-all.

### Decision 6 — `DownloadTerminalStatus` becomes a wire type (first status promotion)

`DownloadTerminalStatus = 'completed' | 'failed' | 'cancelled' |
'interrupted'` is added to `@ft5/ipc-contracts/sync-service` (commands.ts,
beside the downloads command types). **This is a real contract addition:**
migrate keeps the five statuses DB-only (no wire change); this change is the
first to put the terminal subset (excludes `in-flight`) on the wire, as the
`clear-history` filter vocabulary.

### Decision 7 — Renderer config writes are read-modify-write (preserve `providers`)

`ServiceConfigStore.setRaw` rewrites `config.json` **wholesale**
(serializes the passed `next` verbatim). So the renderer MUST write config
as `getConfig() → spread-merge downloadHistory → setConfig()`, preserving
`schemaVersion` and the existing `providers` (the OAuth app secrets). A
naive `setConfig({ schemaVersion: 1, providers: {}, downloadHistory })`
would **wipe the OAuth secrets**. There is no existing renderer
read-modify-write precedent (`oauth-form` only imports the type), so this
change introduces a small, dedicated, tested config helper that does the
merge. This is a spec requirement + a critical test, not an implementation
detail.

### Decision 8 — Desktop bridge: this is the first renderer consumer of config get/set

`sync:get-config` / `sync:set-config` exist at the channel map but are not
exposed to the renderer. This change adds the desktop-main IPC handler +
preload `window.api` exposure for them, plus the same end-to-end bridge for
`downloads:clear-history` (mirroring the existing `downloads:list-active`
bridge at `channels.ts:40`).

## Risks / Trade-offs

- **Naive config write wipes OAuth secrets** → Decision 7 read-modify-write
  helper + a critical test asserting `providers` survives a `downloadHistory`
  write.
- **Apply before migrate merges → red tests** → Dependencies section makes
  the order explicit; apply waits for / stacks on migrate.
- **Blind filtered clear (no list to preview)** → Mitigated by a confirm
  dialog that names the filter and a toast reporting the actual `{ deleted }`
  count; the full list view is a deliberate later follow-up.
- **Malformed hand-edited `downloadHistory`** → Decision 2 defensive read +
  set-config validation reject out-of-set values, falling back to defaults.
- **`Date.now()` in prune window math** → inject a clock / `vi.useFakeTimers`
  for the window-boundary and 24 h-timer tests.

## Migration Plan

1. Land `migrate-download-registry-to-sqlite` first (dependency).
2. Contract: extend `ServiceConfig`; add `downloads:clear-history` +
   `DownloadTerminalStatus` to `@ft5/ipc-contracts`.
3. Service: `pruneDownloadHistory` + config-gated scheduler (bootstrap,
   after the sweep); `clear-history` handler; set-config validation.
4. Desktop bridge: get/set-config + clear-history to the renderer.
5. Renderer: read-modify-write config helper; Settings → Downloads controls.
6. **Rollback:** additive/forward-only. Reverting the code leaves an unused
   optional `downloadHistory` field (ignored by older readers) and an unused
   command type; no data migration to undo.

## Visual direction

Resolved via the visual-refinement step (Visual Companion, 2026-06-28).
All controls reuse existing `settings-dialog.tsx` primitives and row
typography — no new visual vocabulary.

### Settings → Downloads: a "Download history" group (below the existing rows)

Three rows, mirroring the Motion / Explorer / Downloads row layout
(left text stack = label + helper; right-aligned control):

1. **Auto-delete old history** — a `Switch` row, identical in structure to
   the existing Motion-Safe / Always-ask rows (`Label htmlFor` + `Switch`,
   `aria-label`). Helper text discloses the behavior and reflects the
   window, e.g. "History older than 90 days is deleted automatically."
   Default on.
2. **Keep for** (retention window) — a `DropdownMenuRadioGroup` trigger
   (`Button variant="outline" size="sm"` + chevron), identical to the
   Explorer page-size control. Items: `30 / 90 / 180 / 365 days`; default
   `90`. When auto-prune is **off**, the trigger is `disabled` (dimmed)
   and not focusable — the disabled state is conveyed by the native
   `disabled` attribute, not color alone.
3. **Clear download history** — a SINGLE destructive-outline `Button`
   ("Clear download history…") that opens the confirm dialog. No inline
   filters in the settings row (Approach A).

### The "Clear download history" confirm dialog (Approach A)

A `Dialog` (basename contains `dialog` → may use `rounded-lg` per the
repo's radii-ceiling guardrail; name the file e.g.
`clear-history-dialog.tsx`). Reuse the `SettingsDialog` /
`AddDatasourceDialog` focus-restoration pattern (`returnFocusTo` +
`onCloseAutoFocus`). Contents, top-down:

- **Title** "Clear download history"; subtitle "Choose which records to
  remove."
- **STATUS** (uppercase `.label`-style heading) — four **toggle chips**
  (`Completed / Failed / Cancelled / Interrupted`) implemented as toggle
  buttons with `aria-pressed`, **all selected by default** (= clear
  everything). These map to the `DownloadTerminalStatus[]` filter.
- **OLDER THAN** — a `DropdownMenuRadioGroup` (same primitive as the
  retention selector): `Any time / 30 / 90 / 180 / 365 days`, default
  "Any time" (no `olderThanMs` ⇒ no age bound).
- **Safety note** (ⓘ, muted callout): "Files already saved to your
  computer are **not** deleted — this only removes the history records."
- **Actions** — `Cancel` (outline) + `Clear records` (destructive
  variant, WCAG AA contrast). "Clear records" is **disabled when zero
  status chips are selected** (an empty status set matches nothing).
- **No live pre-count** (no extra `count` command, per Decision 5). On
  confirm, dispatch `downloads:clear-history` with the chosen
  `{ status?, olderThanMs? }` (omit `status` when all four are selected so
  the wire sends the "all terminal" form; omit `olderThanMs` for "Any
  time") and report the returned `{ deleted }` via a Sonner toast:
  "Cleared N download records" — or "No matching records to clear" when
  `deleted === 0`.

### Accessibility

WCAG AA throughout: labelled controls, keyboard-reachable chips
(`aria-pressed`), Radix-supplied roles on the dropdowns, native `disabled`
on the dimmed retention selector, destructive-button contrast ≥ AA, and
dialog focus-trap + restoration consistent with the existing modals.

## Open Questions

None — the seven stub open questions were resolved on 2026-06-28: (1) no
history-list view (controls only); (2) `retentionDays` = fixed preset union
(Decision 3); (3) controls in the existing Settings → Downloads section;
(4) destructive-confirm dialog stating files are not deleted; (5) disclosure
via static helper text (no separate announcement); (6) cleanup-affordance
Phase 2 overlap deferred to the future history-list-view stub; (7) no
telemetry. Remaining layout specifics are the visual-refinement step's job
(## Visual direction).
