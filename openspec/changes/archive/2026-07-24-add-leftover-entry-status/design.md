## Context

`add-leftover-download-cleanup` (merged 2026-07-04) shipped the Settings →
Downloads "Review leftover files" dialog. It lists KEEP-eligible terminal
`downloads` rows whose partial file still exists on disk, and lets the user
delete them per-row or in bulk.

The list deliberately spans three terminal dispositions — `failed`, `cancelled`,
and `interrupted` — but the wire shape it renders from, `LeftoverEntry`, carries
no indication of which one a given row is. The renderer's `reasonLine` therefore
derives its text purely from `failureMessage` / `failureTag`:

```ts
const reason =
  e.failureMessage ??
  (e.failureTag !== null ? e.failureTag.replace(/-/g, " ") : null) ??
  "Download failed";
```

A cancelled or interrupted row typically records neither a tag nor a message, so
both `??` arms fall through and every such row is labelled **"Download failed"**.
The same inaccuracy appears one level up in the dialog's own description, which
describes the contents as files "left on disk by past **failed** downloads".

The information needed to fix this already exists service-side: the handler's
query filters on exactly this column (`WHERE status IN ('failed', 'cancelled',
'interrupted')`). It is simply never projected into the response.

Constraints:

- The `downloads.status` column already exists; no schema change is available or
  needed.
- The service and the desktop app ship as one artifact (the desktop supervisor
  spawns the bundled `fs-sync` service), so wire changes land atomically.
- The handler is documented READ-ONLY and MUST NOT throw; a bad row is skipped,
  never surfaced as an error.

## Goals / Non-Goals

**Goals:**

- Every leftover row states its actual terminal disposition, so a cancelled file
  is never described as a failure.
- Reuse the existing terminal-status wire vocabulary rather than introducing a
  parallel enum that can drift from it.
- Keep user-facing English out of the service layer.
- Keep the change additive: no removed field, no narrowed field, no request-shape
  change, no change to any delete path.

**Non-Goals:**

- Changing `downloads:delete-partial`, the bulk-delete loop, or any other delete
  path.
- Changing the `downloads` table schema, retention policy, or pruning behaviour.
- Changing the dialog's row *layout* (icon, name, size, Delete button). This
  change touches copy only.
- Re-labelling the other consumers of `DownloadTerminalStatus` (e.g. the
  clear-history filter UI). They are correct as-is.
- Pagination, sorting, or filtering changes to `downloads:list-leftover`.

## Decisions

### Decision 1 — Put a raw status value on the wire, not a pre-composed string

`LeftoverEntry` gains `status`, a machine value the renderer humanizes. The
service does not compose display text.

*Alternatives considered.* A pre-composed `reason: string` field would centralize
the copy in one place, but it pushes user-facing English into the service layer,
makes the wording untestable from the renderer that owns every other string in
this dialog, and forecloses future localization. It also breaks the established
pattern: `DownloadTerminalStatus` already crosses this wire as a value, not as
prose. A third option — inferring the disposition in the renderer from
`failureTag === null` — was rejected outright because it cannot distinguish
`cancelled` from `interrupted` (both record a null tag), so it would only half-fix
the bug while encoding a fragile assumption.

### Decision 2 — Derive `LeftoverStatus` from `DownloadTerminalStatus`

```ts
export type LeftoverStatus = Exclude<DownloadTerminalStatus, "completed">;
// => "failed" | "cancelled" | "interrupted"
```

*Alternatives considered.* Reusing `DownloadTerminalStatus` unchanged would add no
new type name, but it is wider than reality: `completed` is representable on a
wire where it can never occur, forcing the renderer to carry a branch (or a
fallback) for an impossible case — precisely the kind of unreachable path that
rots or gets wrongly filled in later. Declaring an independent
`"failed" | "cancelled" | "interrupted"` union would be equally narrow but would
duplicate three literals that already exist, letting the two vocabularies drift
apart silently. Deriving via `Exclude` gets both properties at once: a single
source of truth that follows the base vocabulary automatically, and a type exactly
as narrow as the data.

### Decision 3 — The reason line leads with the disposition

The composed shape is uniform across every row:

```
<status label> · [detail] · <when>
```

`cancelled` and `interrupted` rows carry no detail segment; `failed` rows keep
their existing `failureMessage` (or humanized `failureTag`) as the detail. The
`"Download failed"` fallback is deleted — with `status` required, no row can be
unlabelled.

*Alternatives considered.* Prefixing the status only when no message exists would
be a smaller visible diff (failure rows keep their exact current text), but it
makes the list structurally inconsistent: slot one would sometimes hold a
disposition and sometimes a detail, which is harder to scan in a list whose entire
purpose is triage. Rendering the status as a separate badge beside the filename
would give the strongest visual separation, but it is a row-layout change and
widens scope well beyond an additive wire fix.

### Decision 4 — Narrow the DB value with a documented cast, not a runtime guard

`downloads.status` is an untyped SQLite TEXT column, so the handler must produce a
`LeftoverStatus` from a `string`. It does so with a cast carrying a comment that
cites the query's own `WHERE status IN (...)` clause as the guarantee.

*Alternatives considered.* A runtime guard that skips rows with an unexpected
status would be defensive, and would match the handler's existing
"skip, never throw" discipline around `stat` failures. It was rejected because the
`WHERE` and the `SELECT` live in a single adjacent prepared statement and cannot
drift independently, the handler already casts `select.all() as LeftoverRow[]`
wholesale, and a branch guarding a SQL-guaranteed invariant is unreachable code —
the same objection that ruled out the wider enum in Decision 2. Applying the
principle consistently in both places matters more than the three lines saved.

### Decision 5 — Correct the dialog description in the same change

The dialog's `DialogDescription` claims the list holds files from past "failed"
downloads. That is the identical inaccuracy as the row labels, in the same
user-visible surface, and fixing the rows while leaving the header would ship a
dialog that contradicts itself. It is one sentence of copy and adds no code path.

### Decision 6 — The status→label strings are lifted to one shared lookup

A single `Record<DownloadTerminalStatus, string>` becomes the source of truth for
humanizing these statuses. The leftover dialog indexes it with its narrower
`LeftoverStatus` key (sound, since `LeftoverStatus` is a subset of the key type);
`ClearHistoryDialog` keeps its own option ordering and its `completed` entry but
draws its label strings from the same lookup.

*Why not inline.* The first instinct was to declare a three-entry map inside the
leftover dialog — three entries, one consumer, no indirection earned. That reading
was wrong on the facts: `ClearHistoryDialog`, in the same directory and the same
Settings → Downloads section, already holds these exact strings, so a second
consumer exists today rather than hypothetically. Duplicating them would let two
adjacent dialogs drift into naming the same state differently — precisely the
failure mode Decision 2 rejected when it derived `LeftoverStatus` instead of
declaring a parallel union. Being strict about the type while duplicating its
labels would be incoherent; the same principle applies to both.

*Trade-off accepted.* This is the one place the change touches an existing,
working file rather than being purely additive. The risk is contained: only the
label strings move, `STATUS_OPTIONS` keeps its shape, order, and `completed`
entry, and the existing clear-history tests cover the result.

## Visual direction

Scope is copy only. No layout, spacing, color, icon, or motion change — the row
keeps its existing icon / name / size / Delete structure, and the reason line
keeps its existing `text-muted-foreground pl-6 text-xs` treatment.

**VD1 — Status labels reuse the sibling dialog's vocabulary, verbatim.**
`ClearHistoryDialog`, in the same Settings → Downloads section, already humanizes
this exact `DownloadTerminalStatus` vocabulary in its `STATUS_OPTIONS` map:

| `status` | label |
| --- | --- |
| `failed` | `Failed` |
| `cancelled` | `Cancelled` |
| `interrupted` | `Interrupted` |

These strings are adopted unchanged. Two adjacent dialogs in one settings section
naming the same underlying states differently would be a visible inconsistency,
so this is settled by precedent rather than preference — including the double-l
"Cancelled", which matches the spelling used throughout the codebase. Per
Decision 6 the strings are not copied but shared: both dialogs read one lookup, so
a future rename lands in both surfaces at once.

**VD2 — Reason-line shape.** Segments joined by the existing `·` separator (the
separator already used by this line today, unchanged):

```
Cancelled · 3 days ago
Interrupted · 2 hours ago
Failed · ran out of retries · 3 days ago
Failed · integrity failed · 1 day ago
```

The status label is always present and always first. The detail segment appears
only for rows that recorded one. The relative-time segment is omitted when
`endedAt` is null, exactly as today.

**VD3 — Tag redundancy is accepted, not engineered around.** When a `failed` row
has no `failureMessage`, the humanized `failureTag` remains the detail. A few tags
read redundantly against the leading label ("Failed · integrity failed"), but most
do not ("range not honored", "exhausted retries", "network error"). Suppressing or
rewriting the segment would mean the UI editorializing over a stored diagnostic
value and would hide information the user may need; the mild redundancy is the
better trade. No special-case string matching in the renderer.

**VD4 — Dialog description.** The `DialogDescription` becomes:

> Incomplete files left on disk by downloads that didn't finish. Deleting one
> removes it from your computer.

It characterizes the collection accurately across all three dispositions while
staying one short sentence, and deliberately does not enumerate the statuses —
each row already states its own one line below. The second sentence is unchanged.

**VD5 — Accessibility.** The reason stays plain text inside the row, so it remains
part of the row's readable content for assistive tech; no ARIA is added, since
semantics are already sufficient. Contrast is unchanged (same muted token on the
same surface), so the existing WCAG AA compliance is preserved. Making the
disposition explicit in text is itself a small a11y improvement: the row's state
no longer has to be inferred from the absence of detail.

## Risks / Trade-offs

- **A required field on an existing wire type could break a mismatched peer.** →
  The `fs-sync` service is bundled with and spawned by the desktop app, so the two
  always ship together; there is no independent-deploy path that could pair a new
  renderer with an old service. The contract-layer type test pins the field, so a
  regression surfaces at typecheck rather than at runtime.
- **Leading every row with a status adds mild redundancy** on failures whose
  message already implies failure ("Failed · ran out of retries"). → Accepted
  deliberately in Decision 3: uniform structure is worth more in a triage list
  than avoiding a repeated word, and it is the shape the original stub sketched.
- **Historic rows predate nothing** — every `downloads` row has always had a
  `status`, so there is no backfill and no null case to design around. The field
  is safely required rather than optional.
- **The cast in Decision 4 trusts the query.** → If the `WHERE` clause is ever
  widened without widening `LeftoverStatus`, the cast would silently lie. Mitigated
  by keeping both in the same statement, by the comment tying them together, and by
  the service-layer test asserting all three statuses round-trip.

## Migration Plan

None required. No schema change, no data backfill, no config change, and no
persisted format is affected — `downloads.status` has always been populated. The
change is additive on the wire and ships atomically with the desktop bundle.
Rollback is a plain revert of the commit range.

## Open Questions

None. The four questions carried by the original stub — field shape, wire
vocabulary, reason-line composition, and whether to correct the dialog
description — were resolved in brainstorming and are recorded as Decisions 1, 2,
3, and 5 above. Exact user-facing strings are settled under "Visual direction".
