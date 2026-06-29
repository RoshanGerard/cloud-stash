## Context

A correctly-authenticated Google Drive datasource that hits a runtime 403
`insufficientPermissions` (too-narrow grant — most often the user de-selected the
Drive scope on Google's granular-consent screen) is mapped by the Drive engine
strategy to `provider-error`
([`googledrive-client.ts:2382-2396`](../../../packages/fs-datasource-engine/src/strategies/googledrive-client.ts#L2382-L2396)),
collapsed to `FilesErrorTag.Other` at the fs-sync mapper
([`files-error-mapping.ts:71-118`](../../../services/fs-sync/src/commands/files-error-mapping.ts#L71-L118)),
and rendered as the dead "Failed to load: \<message\>" state
([`file-explorer.tsx:859-868`](../../../apps/desktop/src/renderer/src/features/file-explorer/file-explorer.tsx#L859-L868))
— no Reconnect/Remove. The user's only escape was hand-deleting
`credentials.json`.

Three facts shape the fix:

1. **A proactive scope check already mints the target error shape.**
   `checkScopeSufficiency`
   ([`googledrive-client.ts:991-1009`](../../../packages/fs-datasource-engine/src/strategies/googledrive-client.ts#L991-L1009))
   throws `DatasourceError { tag: AuthRevoked, raw: { kind: "scope-insufficient",
   requiredScope, actualScope }, message }`. The runtime reclassification reuses
   this discriminator verbatim.
2. **The reconnect view already routes `auth-revoked`** and carries a pre-built,
   comment-only **auth-error slot**
   ([`invalid-datasource.tsx:389-396`](../../../apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx#L389-L396))
   with `## Visual direction` pre-specified by the merged sibling change
   `fix-reconnect-stuck-connecting-button`.
3. **The wrong-account block reads its anchor from the stored credential.**
   `enforce-oauth-reconnect-account-match` reads the expected account via
   `credentialStore.get(datasourceId)` →
   `authResult.meta.account.sub` ([`loopback-broker.ts:272-275`](../../../services/fs-sync/src/oauth/loopback-broker.ts#L272-L275)).
   This is the linchpin against auto-evict (D2).

## Goals / Non-Goals

**Goals:**
- A runtime 403 `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`
  from any Drive read path is classified as an auth error that routes to the
  shared reconnect view — never the dead "Failed to load" state.
- The reconnect view shows a provider-parameterized steering headline + an
  "Authentication error: \<engine message\>" detail, so the user knows to grant
  full Drive access (breaking the granular-consent re-deny loop).
- The stale credential is replaced with a clean full-scope grant on Reconnect,
  with **zero** manual file deletion.

**Non-Goals:**
- Auto-evicting the cached credential on classification (D2 — rejected).
- OneDrive's Graph insufficient-scope equivalent (different error shape) — a
  noted follow-up, not this change.
- Investigating why the proactive `checkScopeSufficiency` did not pre-empt this
  runtime case (Q6) — a follow-up; the runtime backstop is the deliverable.
- A redesign of the engine's 8-tag error taxonomy. The fix is a targeted
  reclassification + a single new flat-optional envelope field.

## Decisions

### D1 — Reclassify the runtime 403 to `auth-revoked` + `scope-insufficient` (reuse, not a new tag)
The Drive 403 handler gains a branch, placed BEFORE the catch-all
`provider-error`, matching Drive's inner `reason` token `insufficientPermissions`
OR `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. It produces a `DatasourceError` with:
- `tag: AuthRevoked`, `retryable: false`;
- `raw: { kind: "scope-insufficient", requiredScope: REQUIRED_DRIVE_SCOPE }`
  (uniform with the proactive check; `actualScope` is omitted because the
  runtime 403 does not carry the issued scope);
- `message`: the **raw provider message** (Drive's "request had insufficient
  authentication scopes"), so the renderer's detail line shows the actual API
  error the user reported. Because the existing `mk()` helper always attaches the
  original thrown object as `raw`, this case constructs the `DatasourceError`
  directly (mirroring `checkScopeSufficiency`) rather than going through `mk()`.

*Alternative considered — mint a dedicated `insufficient-scopes` / `auth-error`
DatasourceErrorTag.* Rejected: `auth-revoked` already routes to the reconnect
view, the proactive check already uses it, and the precise sub-classification the
renderer needs is carried by `raw.kind` + the new envelope `authErrorKind` (D3).
A new tag would ripple through `normalizeFilesError`, the FilesErrorTag union, and
every tag-exhaustive switch for no behavioral gain.

### D2 — Defer eviction to reconnect-overwrite; reject auto-evict (load-bearing)
The user asked the app to auto-delete the cached credential the instant the error
hits. **Rejected**, for two independent reasons:
1. **Regression.** The wrong-account block reads its expected-account anchor from
   the stored credential ([`loopback-broker.ts:272-275`](../../../services/fs-sync/src/oauth/loopback-broker.ts#L272-L275)).
   Auto-evicting before Reconnect removes the anchor → `readBoundAccount` returns
   `null` → the hard block silently no-ops → a wrong-account reconnect would
   rebind the datasource. That regresses `enforce-oauth-reconnect-account-match`,
   shipped 8 days ago on this same branch.
2. **Redundant.** A successful Reconnect's `credentialStore.put` REPLACES the
   per-datasource credential entry
   ([`config-file.ts:90-96`](../../../services/fs-sync/src/credential-store/config-file.ts#L90-L96):
   `{ ...content.credentials, [datasourceId]: creds }`) — a clean full-scope slate
   with no manual file deletion. The user's hand-delete was a workaround for the
   *missing Reconnect affordance*, not an independent requirement; D1 + the
   callout restore the affordance, so the underlying need is met without eviction.

A pre-reconnect re-Explore simply re-hits the same deterministic non-retryable
error and re-routes to the reconnect view — no silent loop, no harm from the
lingering narrow token.

*Alternatives considered:* (a) auto-evict immediately (the user's literal ask) —
rejected per above; (b) evict the token but preserve `meta.account` (anchor-safe
partial evict) — rejected: functionally identical to defer at reconnect time, but
needs a new partial-evict primitive (today's `sync:delete-credentials` is
all-or-nothing) for zero behavioral gain. **User confirmed Defer (2026-06-29.)**

### D3 — `FilesErrorEnvelope.authErrorKind` flat-optional discriminator
`FilesErrorEnvelope` ([`files.ts:55-91`](../../../packages/ipc-contracts/src/files.ts#L55-L91))
gains `authErrorKind?: "scope-insufficient"` — a flat-optional field mirroring the
existing `existingPath` / `retryAfterMs` shape (NOT a discriminated union, so
callers read it without re-narrowing on `tag`). The value is a string-literal
union seeded with the single member `"scope-insufficient"`; future auth
sub-classes extend the union without a breaking change. The mirror inner shape
`FilesErrorEnvelopeInner` ([`files-error-mapping.ts:19-25`](../../../services/fs-sync/src/commands/files-error-mapping.ts#L19-L25))
gains the same optional field.

### D4 — `normalizeFilesError` stays pure; threads `authErrorKind` from `raw.kind`
`normalizeFilesError` gains a defensive `readAuthErrorKind(raw)` (mirroring the
existing `readExistingPath`): when `raw` is an object with
`kind === "scope-insufficient"`, the envelope carries
`authErrorKind: "scope-insufficient"`; otherwise the field is omitted. The
function remains **pure** — no `credentialStore`, no side effects, so the
`files:list` handler's deps (`{ resolveClient }`) are unchanged and no eviction is
threaded onto the read path. The thread is origin-agnostic at the mapper layer:
any engine error carrying `raw.kind === "scope-insufficient"` gets the
discriminator. In practice only the runtime-403 path (D1, via `listDirectory` →
`files:list`) reaches this mapper and the renderer callout. The proactive
`checkScopeSufficiency` throws from `doStatusImpl` / `doTestConnectionImpl`
([`googledrive-client.ts:1074-1083`](../../../packages/fs-datasource-engine/src/strategies/googledrive-client.ts#L1074-L1083))
— the datasource status / connection-check path, NOT `listDirectory` — so it does
not flow through `files:list` / `normalizeFilesError` and does **not** render this
callout. (Routing that proactive error to the same callout would be a separate
follow-up; it is out of scope here.)

### D5 — Renderer fills the dormant auth-error slot; steering headline + raw detail
The store gains an `authErrorKind` slot (parallel to the existing
`error` / `errorTag` — [`store.ts:149,185`](../../../apps/desktop/src/renderer/src/features/file-explorer/store.ts#L149)),
populated from the `files:list` error envelope. `file-explorer.tsx` threads
`authErrorKind` + the engine `message` through `<InvalidDatasourceArm>` into new
`<InvalidDatasourceState>` props. The component renders the auth-error callout in
the dormant seam ONLY when `authErrorKind === "scope-insufficient"`:
- **Headline** (provider-parameterized, derived in the renderer from
  `providerDisplayName`): "**{Provider} needs full-access permission**".
- **Detail** (lower-emphasis): "Authentication error: \<engine message\>".

The callout coexists with the reconnect view's live **Reconnect** + ghost
**Remove** (the routing tag is `auth-revoked`, an *initial* state, not a terminal
session failure — so the primary stays "Reconnect", not "Try Again"). Copy
wording **confirmed by the user (2026-06-29):** steering headline + raw detail.

### D6 — Drive-only this change; OneDrive deferred
Only the Google Drive strategy is reclassified. OneDrive's Graph
insufficient-scope error has a different shape (no Drive `reason` tokens) and is
explicitly deferred to a follow-up. The `authErrorKind` contract field +
renderer callout are provider-agnostic and ready for OneDrive when it lands. No
cross-strategy contract-test hook is added — the classification is Drive-shaped
and a shared hook for a single implementer is premature abstraction; the
reclassification is tested directly in `googledrive-client.test.ts` alongside the
existing 403-`reason` cases.

## Risks / Trade-offs

- **Newer responses may carry the insufficient-scope signal outside the first
  `errors[].reason`** (e.g. `ACCESS_TOKEN_SCOPE_INSUFFICIENT` under
  `error.status`/`error.details`) → match both documented `reason` tokens; pin
  the exact extraction with test fixtures during apply, and keep the catch-all
  `provider-error` as the safety net for any unrecognized 403.
- **Proactive scope-check path does NOT surface this callout** → the proactive
  `checkScopeSufficiency` runs only in `status()` / `testConnection()` (the
  datasource-status / connection-check path), not `listDirectory`, so its
  `auth-revoked` + `scope-insufficient` error never flows through `files:list` /
  `normalizeFilesError` and the renderer callout is not rendered for it.
  Accepted: the runtime-403 backstop is the deliverable for the reported repro
  (Explore → `files:list`). Unifying the proactive path onto the same callout is
  a noted follow-up, not this change.
- **A genuine provider-error must not be reclassified** → the new branch matches
  ONLY `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`; quota,
  domainPolicy, dailyLimitExceeded, insufficientFilePermissions stay
  `provider-error` (explicit non-regression test).
- **Additive contract field** → `authErrorKind` is optional and absent on every
  existing envelope; no consumer is forced to change. Backward-compatible.

## Migration Plan

None. Additive optional contract field + a Drive-only reclassification + a
renderer callout. No data, schema, or IPC-channel changes; fully
backward-compatible. Rollback = revert the change; absent `authErrorKind` simply
falls back to the prior `auth-revoked` reconnect-view copy.

## Open Questions

- **Why didn't `checkScopeSufficiency` pre-empt the runtime case? (Q6)** — Out of
  scope; documented follow-up. The runtime backstop is the deliverable.
- **OneDrive Graph insufficient-scope equivalent** — follow-up (D6).

## Visual direction

Converged via the visual-refinement pass (text-only, 2026-06-29 — companion
declined; the slot was already pre-specified by the merged sibling change). The
auth-error callout is the **red sibling of the amber account-mismatch callout**
and inherits the sibling change's pre-specified "Auth-error slot"
([archive/2026-06-29-fix-reconnect-stuck-connecting-button/design.md](../archive/2026-06-29-fix-reconnect-stuck-connecting-button/design.md)).

- **Placement — below the button row.** The callout renders in the dormant seam's
  existing location ([`invalid-datasource.tsx:389-396`](../../../apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx#L389-L396)),
  BELOW the primary **Reconnect** + ghost **Remove** row — structurally identical
  to where the amber "Wrong account" callout sits (file-explorer canonical
  requirement "Reconnect view renders the account-mismatch callout").
- **Container/palette (red-keyed mirror of the amber callout — AA-safe literal
  shades).** A bordered block using the SAME approach as the shipped amber
  callout: literal palette shades with dark-text-on-light-fill so the text sits on
  the callout's OWN fixed-shade background, making contrast theme-independent.
  `border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40`, with a
  red-keyed left accent `border-l-2 border-l-red-500`. **Headline:**
  provider-parameterized, `text-red-800 dark:text-red-300` semibold 13px —
  "{Provider} needs full-access permission" (e.g. "Google Drive needs full-access
  permission"), derived from `providerDisplayName`. **Detail:** a smaller (12px,
  regular weight), lower-emphasis line `text-red-900 dark:text-red-200` —
  "Authentication error: \<message\>" rendering the engine message verbatim. Icon
  `text-red-600 dark:text-red-400`. *Deviation from the sibling slot's original
  `text-destructive` on `bg-destructive/5`:* the adversarial a11y review proved
  that approach fails WCAG AA in the light + `serene-blue` themes (the
  page-background-derived tint drops `text-destructive` below 4.5:1, worsened by
  the `/90` opacity on the detail). The literal-shade mirror of the amber callout
  is AA across all themes (~8–10:1 on its own `red-50` / `red-950` fill). Red is
  reserved for this hard auth error (amber stays reserved for the recoverable
  wrong-account correction).
- **Body supersede (honesty — extends D3's unified message path with a 4th case).**
  When `authErrorKind === "scope-insufficient"`, the misleading generic body line
  "Its connection details are missing or invalid…" is **suppressed** — the
  credential is present, merely under-scoped, so that line would contradict the
  callout. The heading "This datasource needs reconfiguring" stays; the callout
  below the buttons carries the accurate explanation. This continues the sibling
  change's principle of never showing "missing or invalid" as the explanation when
  it is wrong.
- **Precedence — one callout at a time.** The auth-error callout renders only when
  `!isWaiting && !isAccountMismatch`. An in-progress reconnect (status line +
  Cancel) or a wrong-account session failure (amber callout) takes precedence over
  the stale initiating files-error's red callout.
- **Primary label.** Stays **Reconnect** (the routing tag is the initial
  `auth-revoked`, not a terminal session failure — `showDeadEnd` is false, so the
  existing `primaryLabel` is already "Reconnect").

**A11y / motion:** the view's `role="alert"` `aria-live="polite"` semantics are
preserved; the headline (`text-red-800` / `dark:text-red-300`) and detail
(`text-red-900` / `dark:text-red-200`) pass WCAG AA on the callout's own
`bg-red-50` / `dark:bg-red-950` fill across ALL themes (light, dark, serene-blue)
— the text-on-fill pairing is theme-independent because the fill is a fixed
literal shade, not a page-background-derived tint; any decorative icon is
`aria-hidden`; the callout is **motion-free** (no `animate-spin` — enforced by
`scripts/motion-budget.test.ts`).
