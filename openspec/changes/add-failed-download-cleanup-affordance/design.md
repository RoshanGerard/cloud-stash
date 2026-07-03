## Context

This is Phase 1 of the failed-download-cleanup affordance, grounded in a
2026-07-03 read of the current code (the originating 2026-04-30 stub was
substantially stale). Key current-state facts that shape the design:

- **The `download-failed` event carries no disposition and no path.**
  `DownloadFailedPayload` is `{ downloadJobId, datasourceId, tag, message }`
  ([events.ts]). The service *decides* keep-vs-delete disposition in
  `files-download.ts` (~:1490) but never transmits it. So the renderer
  cannot tell whether a deletable partial exists — a wire change is
  required (the stub's "no infrastructure" claim was false).

- **As-shipped disposition matrix** (corrects the stub): KEEP =
  {environmental-exhausted, wall-time, `auth-revoked`, user-cancel,
  **byte-count-mismatch**}; DELETE = {range-mismatch, integrity-failed}.
  `DELETE_ON_TERMINAL = new Set([RangeMismatchError, IntegrityFailedError])`
  (files-download.ts:1826). `range-not-honored` is no longer terminal
  (mid-loop rewrite-from-0). byte-count-mismatch, range-mismatch and
  integrity-failed all collapse to `tag: "other"` — so **tag alone cannot
  gate the button**, which is why an explicit signal is needed.

- **A user Retry never resumes from the kept partial.** `finalize`
  deletes the in-memory registry entry (registry.ts:349) and `findByKey`
  reads only in-memory state (:367), so the resume-of-self carve-out
  cannot fire post-failure. Retry re-runs the conflict gate (default
  `conflictPolicy: "fail"`), stats the partial, returns `tag: "conflict"`
  → the ConflictResolutionDialog (use-download-orchestrator.ts:394-413).
  overwrite = re-download from byte 0 (partial discarded); keep-both =
  a sibling `file (1).ext` = double orphan; cancel = orphan stays.

- **The durable `downloads` table** persists `target_path` (the actual
  landing path, incl. any keep-both suffix) and `status`, but has no
  disposition column and no `list-history` read command. `finalize`
  keeps the terminal row (it does not delete it).

- **`validateToPath`** (path-validator.ts:57) is a boundary check
  (absolute + no-traversal + not-in-`~/ft5/sync_app` + writable-parent),
  NOT a download-directory containment check. No download-dir allowlist
  exists anywhere.

## Goals / Non-Goals

**Goals:**

- Let the user discard a kept partial file with one click from the
  failure toast, reclaiming disk and clearing the conflict-prompt friction
  a later re-download would hit.
- Do it safely: no filesystem path crosses IPC; the backend can only
  delete a path it itself recorded as a download target; an already-gone
  file is treated as success.
- Build a primitive that Phase 2 (aggregate settings-list cleanup) can
  reuse unchanged.

**Non-Goals:**

- Phase 2 aggregate orphan list in Settings (needs a `downloads:list-history`
  read command + a new list UI). Deferred to a follow-up stub.
- Auto-cleanup on launch; renaming partials to `.part` / `.crdownload`;
  resume-from-partial semantics.
- Telemetry / click-through counters — no telemetry pipeline exists in
  the app; wiring one is out of scope (YAGNI).
- Changing the disposition policy. This change only *reports* the existing
  disposition and acts on the user's request.

## Decisions

### D1 — The primitive is keyed on `downloadJobId`, not a filesystem path

`downloads:delete-partial { downloadJobId } → { deleted: boolean }`. The
handler resolves `target_path` server-side from the `downloads` SQLite row
and `unlink`s it. **No filesystem path ever crosses IPC.**

- *Alternative (stub's design):* renderer passes `toPath`; handler reuses
  `validateToPath`. Rejected — `validateToPath` is not a containment check,
  so it would permit deleting any writable path outside the service dir;
  and for keep-both downloads the renderer's requested `toPath` differs
  from the actual `effectiveTargetPath` on disk. Keying on `downloadJobId`
  makes the guard "we only delete a path we recorded" — inherently safer —
  and always targets the real landing path.

### D2 — Guard is "terminal + recorded", not "kept"

The handler proceeds iff (a) a `downloads` row exists for `downloadJobId`
(recorded) AND (b) its `status !== 'in-flight'` (terminal — never unlink a
file that is actively being written). Row-not-found → no-op success.

- The DB *cannot* distinguish kept-vs-deleted (byte-count-mismatch KEEP and
  range-mismatch/integrity DELETE all persist `failure_tag = 'other'`; no
  disposition column). So a backend "verify kept" check cannot be built
  correctly and is not attempted. Kept-vs-deleted gating is a UI concern
  handled by `partialKept` (D3). DELETE-disposition rows whose file the
  service already unlinked simply hit ENOENT → success (D4), harmlessly.

### D3 — UI gating uses an emit-time `partialKept` boolean on `download-failed`

`partialKept?: boolean`, OPTIONAL and default-false, added to
`DownloadFailedPayload`. Computed where disposition is actually known
in-process — the `download-failed` emit sites in `files-download.ts`:
`partialKept = (disposition keeps the partial) && bytesDownloaded > 0`.
The toast renders "Delete partial" iff `partialKept === true`.

- *Why a boolean, not the path:* the toast only needs to know *whether* a
  deletable partial exists; the path is resolved server-side by
  `downloadJobId` (D1). One optional boolean is the minimal wire change.
- *Why optional/default-false:* hydrated-from-disk failure toasts and
  events from an older service render no button rather than a broken one.
- *Why `bytesDownloaded > 0`:* a failure before any bytes were written
  leaves no meaningful partial to offer deleting.

### D4 — `unlink` error mapping: ENOENT = success, permission errors = envelope

The partial being already gone (user deleted it in Finder/Explorer, or it
was a DELETE-disposition row) is the desired end state → `{ deleted: true }`.
`EACCES` / `EPERM` → an error envelope the toast renders inline. This
mirrors the handler's existing internal unlink, which swallows failures
non-fatally.

### D5 — One-click, no size-threshold confirmation

Deleting a kept partial is non-destructive of source (the file is still on
the provider; a Retry re-downloads from byte 0 regardless — the partial is
never resumed from). The cost of deletion is only re-download time. A
size-gated two-click confirmation would add ceremony to a low-stakes,
reversible action. Rejected (the stub's Q3). The global toast close-X plus
the explicit "Delete partial" label are sufficient guardrails.

### D6 — `downloads:` namespace + wired like `downloads:clear-history`

The command lives in the `downloads:` namespace (matching `list-active` /
`clear-history`), not the stub's `files:delete-partial`. It is a
DB-read + local-`unlink`, so it is dispatched like `downloads:clear-history`
— needing `deps.db` and an fs `unlink`, NOT the engine / `resolveClient`.
The renderer binding sits on the sync/downloads `window.api` surface, not
`window.api.files.*`.

## Risks / Trade-offs

- **The `downloads` row could be pruned between failure and click** (24h+
  retention prune) → the handler's DB lookup returns nothing. → Mitigated
  by D2's row-not-found → no-op success; the toast dismisses. In practice
  the click happens seconds after failure, far inside any retention window.

- **`partialKept` predicate drift** — if a future disposition change adds a
  KEEP cause, the emit-time predicate must be updated alongside it. →
  Mitigated by co-locating the predicate at the `download-failed` emit
  sites (the same place disposition is decided) and by unit tests that pin
  `partialKept` per disposition class.

- **Toast layout: two actions on a currently single-action toast.** The
  failure toast is `toast.error` with one native action slot (Retry).
  Rendering a second "Delete partial" action requires either Sonner's
  `cancel` slot or moving to the fresh-id `toast.custom` pattern the
  success toast already uses (`buildSuccessRender`). → This is a
  *visual/implementation* decision deferred to the post-propose visual
  refinement pass; the spec states the behavior (a second Delete-partial
  action appears when `partialKept`), not the Sonner mechanism, and
  preserves the existing invariant that terminal toasts carry no Cancel
  action.

## Visual direction

Settled in the post-propose visual-refinement pass (2026-07-04). Scope is
the download failure toast's new "Delete partial" action.

- **VD1 — Layout mechanism: fresh-id custom card, kept-partial path only.**
  When `partialKept === true`, the toaster dismisses the in-flight toast and
  renders a **fresh-id `toast.custom`** card (mirroring the success toast's
  `buildSuccessRender` fresh-id pattern, which sidesteps the iter-3
  same-id `loading→custom` type-merge-leak). Failures with no kept partial
  keep the existing single-action `toast.error` path **unchanged** — the
  well-tested common path is not touched. (A new `buildFailureWithDeleteRender`
  helper parallels `buildSuccessRender`.)

- **VD2 — Card idiom: red error card via literal palette on a fixed fill.**
  To read as an error (matching the no-partial `richColors` red toast) and
  hit WCAG-AA theme-independently, the card reuses the established literal-red
  family proven in the reconnect callout: fill `bg-red-50 dark:bg-red-950/40`,
  border `border-red-300 dark:border-red-800`, and the "Download failed:
  <message>" line in `text-red-800 dark:text-red-200`. No
  `text-destructive`-on-tint (that failed AA in light + serene-blue themes in
  a prior change).
  - **As-built deviation (2026-07-04):** the originally-planned `OctagonX`
    icon was **omitted** to match `buildSuccessRender`'s deliberate icon-free
    text idiom — the red fill + red "Download failed:" heading already convey
    the error state, and staying icon-free keeps the `React.createElement`
    render tree `JSON.stringify`-serializable for the node-style toaster tests
    (importing a lucide component into the render would defeat that). The
    no-partial `toast.error` toast keeps Sonner's built-in `OctagonX`; the two
    failure renders differ slightly here, an accepted M2 trade-off.

- **VD3 — Actions: Retry primary (right), Delete partial quiet-destructive
  (left).** Mirrors the success card's "Show in folder" (quiet, left) +
  "Open" (primary, right). Row is `flex items-center justify-end gap-3`.
  - **Retry** — the constructive recovery action, visually prominent, right,
    reusing the app's primary button treatment; a solid button that reads on
    the red fill. Same onClick as today (dismiss + `retry()`).
  - **Delete partial** — secondary destructive, left of Retry; a quiet
    button (red text, underline-on-hover, like the success card's quiet link)
    in `text-red-700 dark:text-red-300` (AA on the fill). Label verbatim:
    **"Delete partial"**. One click — no confirmation (per D5).

- **VD4 — Inline error on delete failure.** On an error response
  (EACCES/EPERM), the toast is NOT dismissed; the action row's "Delete
  partial" button is replaced by an inline line **"Couldn't delete the
  partial file: <reason>"** (`text-red-700 dark:text-red-300`, AA); "Retry"
  remains available. Success dismisses the whole toast.

- **VD5 — Accessibility.**
  - Card container `role="alert"` (assertive — a failure with actions),
    consistent with the error semantics of the toast it replaces.
  - Both actions are real `<button>`s with accessible names, keyboard-
    focusable, visible focus rings.
  - The destructive "Delete partial" MUST NOT be the default / auto-focused
    button (avoid accidental Enter-to-delete); Retry, the safe action, is the
    natural default focus target.
  - All text (message, both labels, inline error) ≥ 4.5:1 contrast on the
    card fill in BOTH light and dark themes.
  - Dismissal: rely on the global Sonner close-`✕` (`closeButton`,
    sonner.tsx:40). **Apply-time verify** the close button renders on
    `toast.custom` toasts; if not, add an explicit dismiss affordance to the
    card (the toast is sticky — `duration: Infinity` — so a manual dismiss
    path is required).

- **VD6 — Motion.** None. No new animation; the card appears/dismisses via
  Sonner's existing toast transitions (respects the standing motion budget).

## Migration Plan

Additive and backward-compatible — no migration. The new event field is
optional/default-false; the new command is net-new. No DB schema change.
Rollback = revert the change; older events simply carry no `partialKept`.

## Open Questions

None outstanding for Phase 1. The toast's exact two-action layout is
resolved in the visual-refinement pass (per the workflow), not left open.
