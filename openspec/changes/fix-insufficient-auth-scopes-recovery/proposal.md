# Proposal: A runtime "insufficient authentication scopes" 403 recovers in-app — classify → reconnect view → accurate auth-error callout

## Why

**Repro.** Authenticate a Google Drive datasource with the **correct** account,
then *Explore* it. File load fails with:

> failed to load: request had insufficient authentication scopes.

There is **no in-app recovery** — the generic "failed to load: …" state offers
neither Reconnect nor Remove. The user worked around it by **manually deleting
the `credentials.json` file**. The desktop app should handle this itself.

**Root cause (verified from code).** Three layers:

1. **The engine misclassifies the error.** Google's runtime 403 for a too-narrow
   grant carries inner `reason: "insufficientPermissions"` (newer responses:
   `ACCESS_TOKEN_SCOPE_INSUFFICIENT`). The Drive mapper's 403 branch
   ([`googledrive-client.ts:2382-2396`](../../../packages/fs-datasource-engine/src/strategies/googledrive-client.ts#L2382-L2396))
   special-cases only `rateLimitExceeded` and `authError`/`invalidCredentials`;
   `insufficientPermissions` falls through to the catch-all
   `mk("provider-error", false)` — tagged **`provider-error`**, not an auth tag.

2. **The explorer doesn't route `provider-error` to recovery.** Only
   `auth-revoked` and `invalid-datasource` render the shared reconnect view
   ([`file-explorer.tsx:833-836`](../../../apps/desktop/src/renderer/src/features/file-explorer/file-explorer.tsx#L833-L836));
   `provider-error` collapses to `FilesErrorTag.Other` at the fs-sync mapper
   ([`files-error-mapping.ts:71-118`](../../../services/fs-sync/src/commands/files-error-mapping.ts#L71-L118))
   and renders the dead "Failed to load: \<message\>" state — no
   Reconnect/Remove affordance.

3. **The reconnect view has no auth-error case.** Even when an auth tag DOES
   route to the reconnect view (the proactive scope check already does — see
   below), the view renders only the generic reconnect copy; it never surfaces
   *why* (insufficient scope) or steers the user to grant full access.

**Two facts that make the fix cheap and self-contained:**

- **A proactive scope check already mints exactly the target error shape.**
  `checkScopeSufficiency`
  ([`googledrive-client.ts:991-1009`](../../../packages/fs-datasource-engine/src/strategies/googledrive-client.ts#L991-L1009))
  throws `DatasourceError { tag: AuthRevoked, raw: { kind: "scope-insufficient",
  requiredScope, actualScope }, message: "Drive permissions are too narrow —
  reconnect with full access…" }`. The runtime 403 reclassification mirrors this
  shape exactly, so both the proactive and runtime paths converge on one
  discriminator (`raw.kind === "scope-insufficient"`) and one renderer callout.

- **The reconnect view already routes `auth-revoked` and has a pre-built
  dormant seam.** `fix-reconnect-stuck-connecting-button` (sibling, already
  merged to this branch) left a comment-only **auth-error slot** in
  [`invalid-datasource.tsx:389-396`](../../../apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx#L389-L396)
  with pre-specified `## Visual direction` ("Auth-error slot"). This change fills
  it — no routing or layout work.

## What Changes

- **Engine (Drive):** the 403 handler gains an `insufficientPermissions` /
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT` branch → returns `auth-revoked` carrying
  `raw: { kind: "scope-insufficient", requiredScope: REQUIRED_DRIVE_SCOPE }` +
  the steering message. Genuine `provider-error` reasons (quota, domainPolicy,
  insufficientFilePermissions) are unchanged.
- **Contract:** `FilesErrorEnvelope` gains a flat-optional
  `authErrorKind?: "scope-insufficient"` discriminator (mirrors the existing
  flat-optional `existingPath` / `retryAfterMs` shape).
- **fs-sync:** `normalizeFilesError` (pure) reads the engine error's
  `raw.kind === "scope-insufficient"` and threads `authErrorKind` onto the
  envelope. `auth-revoked` already maps to `FilesErrorTag.AuthRevoked` (→
  reconnect view), so routing is unchanged.
- **Renderer:** the reconnect view's dormant auth-error slot is filled with a
  destructive-palette callout keyed on `authErrorKind`: a provider-parameterized
  steering headline ("Google Drive needs full-access permission") + a
  lower-emphasis "Authentication error: \<engine message\>" detail line.
- **Eviction: DEFERRED, no code.** A successful Reconnect's `credentialStore.put`
  already overwrites the per-datasource credential entry
  ([`config-file.ts:90-96`](../../../services/fs-sync/src/credential-store/config-file.ts#L90-L96)),
  yielding a clean slate with zero manual file deletion — satisfying the user's
  real need. See `design.md` D2 for why auto-evict is rejected (it would disarm
  the just-shipped wrong-account block, which reads its anchor from the stored
  credential).

Out of scope (recorded in `design.md`): OneDrive's Graph insufficient-scope
equivalent (different error shape — follow-up); investigating why the proactive
`checkScopeSufficiency` did not pre-empt this runtime case (follow-up; the
runtime backstop is the deliverable); a redesign of the engine's error taxonomy.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `fs-datasource-engine`: the Google Drive error-normalization requirement gains
  the runtime `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT` →
  `auth-revoked` + `scope-insufficient` reclassification (was `provider-error`).
- `fs-sync-service`: the `FilesErrorEnvelope` contract gains the optional
  `authErrorKind` discriminator, and `files:*` error normalization threads it
  from the engine error's `raw.kind`.
- `file-explorer`: the shared reconnect view renders the auth-error callout
  (steering headline + "Authentication error: \<message\>" detail) when the
  initiating files error carries `authErrorKind: "scope-insufficient"`.

## Impact

- **Code:**
  `packages/fs-datasource-engine/src/strategies/googledrive-client.ts` (403
  branch) + tests; `packages/ipc-contracts/src/files.ts` (`authErrorKind` field)
  + type tests; `services/fs-sync/src/commands/files-error-mapping.ts` (thread
  the field) + tests; `apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx`
  (auth-error callout) + tests.
- **Contract change:** ADD the optional `FilesErrorEnvelope.authErrorKind` field
  — additive, backward-compatible (absent on every existing envelope).
- **No data / schema / IPC-channel changes.** No new dependency.
- **Guardrails:** `scripts/motion-budget.test.ts` (no `animate-spin` — the
  callout is motion-free), WCAG AA on the destructive-tinted callout.

## Provenance

- User-reported 2026-06-29: a correctly-authenticated Google Drive datasource
  failed to load with "request had insufficient authentication scopes"; the user
  recovered by manually deleting `credentials.json`. Stated ideal: the desktop
  should evict cached auth + offer reconnect/remove + show "Authentication
  error: \<the original error message\>".
- **Decisions resolved during brainstorming (2026-06-29):** (1) the eviction ask
  is satisfied by reconnect-overwrite, NOT auto-evict — auto-evict would disarm
  the `enforce-oauth-reconnect-account-match` wrong-account block (anchor read
  from the stored credential) and is redundant; (2) the callout shows a steering
  headline + the raw "Authentication error: \<message\>" detail (both, to break
  the granular-consent re-deny loop). Full rationale + alternatives in
  `design.md`.
- **Sibling change** `fix-reconnect-stuck-connecting-button` (same smoke session,
  already merged to this branch): owns the reconnect-view recovery state machine
  + the dormant auth-error slot this change fills. This change was proposed
  against canonical AFTER the sibling synced, so there is no forward reference.
- Verified code:
  `packages/fs-datasource-engine/src/strategies/googledrive-client.ts`
  (`:2382-2396` 403 → provider-error catch-all; `:991-1009` proactive
  `checkScopeSufficiency` → auth-revoked + `scope-insufficient`),
  `services/fs-sync/src/commands/files-error-mapping.ts` (`provider-error` →
  `Other`), `services/fs-sync/src/oauth/loopback-broker.ts` (`:272-275` reconnect
  anchor read from `credentialStore.get`),
  `services/fs-sync/src/credential-store/config-file.ts` (`:90-96` put
  overwrites the entry),
  `apps/desktop/src/renderer/src/features/file-explorer/file-explorer.tsx`
  (`:833-836` auth-revoked routes to the reconnect view),
  `apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx`
  (`:389-396` dormant auth-error slot).
