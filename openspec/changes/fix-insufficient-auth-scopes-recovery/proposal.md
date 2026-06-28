# Proposal: A runtime "insufficient authentication scopes" 403 is misclassified as provider-error — no recovery, user must hand-delete credentials

**Status**: Stub. Spawned 2026-06-29 from the same real-provider auth smoke
as `fix-reconnect-stuck-connecting-button` (sibling stub). User-reported.

## Why

**Repro.** Authenticate a Google Drive datasource with the **correct**
account, then *Explore* it. File load fails with:

> failed to load: request had insufficient authentication scopes.

There is **no in-app recovery** — the generic "failed to load: …" error
state offers neither Reconnect nor Remove. The user worked around it by
**manually deleting the `credentials.json` file** (forcing a fresh re-auth on
the next connect). The desktop app should handle this incident itself.

**Expected (user's ideal handling).** When this error occurs:

1. **Delete the existing cached authentication** automatically (what the user
   did by hand).
2. **Offer Reconnect / Remove** — route to the shared reconnect view.
3. **Show an accurate message**: `Authentication error: <the original error
   message>`.

**Root cause (verified from code, not hypothesis).** Three layers:

1. **The engine misclassifies the error.** Google's runtime 403 for a
   too-narrow grant carries inner `reason: "insufficientPermissions"` (newer
   responses: `ACCESS_TOKEN_SCOPE_INSUFFICIENT`). The Drive mapper's 403
   branch
   ([`googledrive-client.ts:2382-2395`](packages/fs-datasource-engine/src/strategies/googledrive-client.ts#L2382-L2395))
   special-cases only `rateLimitExceeded` and `authError`/`invalidCredentials`;
   everything else — including `insufficientPermissions` — falls through to
   the catch-all `mk("provider-error", false)`. So this auth problem is
   tagged **`provider-error`**, not an auth tag.

2. **The explorer doesn't route `provider-error` to recovery.** Only
   `auth-revoked` and `invalid-datasource` render the shared reconnect view
   ([`file-explorer.tsx:833-836`](apps/desktop/src/renderer/src/features/file-explorer/file-explorer.tsx#L833-L836));
   `provider-error` falls through to the generic "failed to load: &lt;message&gt;"
   state — a dead end with no Reconnect/Remove affordance.

3. **No automatic credential eviction.** The stale token stays cached, so even
   a manual retry re-uses it. Hand-deleting `credentials.json` is the only
   escape today. (A reusable primitive already exists — see below.)

**Likely cause & loop risk.** On a *correct* account, the narrow grant is most
likely **granular consent** — the user deselected the Drive scope checkbox on
Google's granular-consent screen (Testing-mode testers get that screen), not
merely a stale cached scope. This matters: evict-and-reconnect is necessary
but NOT sufficient — if the re-consent again omits Drive, the recovery
**loops** (evict → reconnect → still insufficient → evict …). The promoted fix
must steer the user to grant full Drive access, not just retry blindly (see
Q4 on message copy).

**Two facts that make the fix cheap:**

- **A proactive scope check already exists** —
  `checkScopeSufficiency`/`isScopeSufficient`
  ([`googledrive-client.ts:991-1008`, `:454-460`](packages/fs-datasource-engine/src/strategies/googledrive-client.ts#L991-L1008))
  maps a too-narrow ISSUED scope to `auth-revoked` (→ reconnect view) BEFORE
  the API call. It evidently didn't catch this case (Q6) — the runtime 403
  classification is the belt-and-suspenders backstop.
- **A reusable eviction handler already exists** — `sync:delete-credentials`
  ([`services/fs-sync/src/commands/delete-credentials.ts`](services/fs-sync/src/commands/delete-credentials.ts))
  clears the per-user credential entry (used by the dashboard Remove path).
  The fix reuses it instead of the user hand-deleting the file.

## Out of scope

- The reconnect-view stuck-button / messaging fix tracked by the sibling stub
  `fix-reconnect-stuck-connecting-button`. THIS change is about *classifying +
  recovering* from the runtime auth error so the reconnect view shows at all;
  the message-fidelity work overlaps and must be coordinated (Q4).
- A broad re-design of the engine's 8-tag error taxonomy. The fix is a
  targeted reclassification + recovery, not a taxonomy overhaul.
- Provider verification / publishing-status concerns. The app must recover
  from the error regardless of why the grant was narrow.

## Open questions (resolve during `/opsx:propose`)

1. **Reclassify to which tag?** `auth-revoked` already routes to the reconnect
   view and the proactive scope check already uses it — reuse it for the
   runtime case (consistent), OR mint a dedicated `auth-error` /
   `insufficient-scopes` tag for precise messaging. Recommend reusing
   `auth-revoked` and carrying the original engine message for the
   "Authentication error: …" copy, unless a dedicated tag earns its keep.

2. **Auto-evict vs evict-on-reconnect.** The user wants the stale credential
   gone. (a) Auto-evict via `sync:delete-credentials` the moment the error is
   classified; (b) defer to the Reconnect click (the reconnect flow re-auths
   anyway). Auto-evict matches the user's mental model (the manual file
   delete) and guarantees a clean slate, but is a side effect on a read path.
   Recommend (a), scoped narrowly to this auth-error tag, with a structured
   log — never a blanket "evict on any error."

3. **Which layer detects & evicts?** Likely seam: engine maps 403
   `insufficientPermissions` → the auth tag (carrying message); the fs-sync
   `files:list` handler, on that tag, calls `delete-credentials` before
   returning the error envelope; the renderer routes to the reconnect view and
   renders "Authentication error: &lt;message&gt;". Confirm the seam — it spans
   `fs-datasource-engine`, `fs-sync-service`, and `file-explorer`.

4. **Message format coordination.** "Authentication error: &lt;original&gt;"
   overlaps `fix-reconnect-stuck-connecting-button` Q6. The reconnect view
   should have ONE message-rendering path that can show: (a) the generic
   missing-credential copy, (b) the wrong-account amber callout, (c) this
   "Authentication error: &lt;engine message&gt;". Decide where the
   "Authentication error:" prefix is assembled (renderer vs envelope) and
   align both stubs on it.
   - **Copy tension (loop-breaker).** The user asked for "Authentication
     error: &lt;original&gt;", but the raw Google string ("request had
     insufficient authentication scopes") is LESS actionable than
     `checkScopeSufficiency`'s existing copy — "Drive permissions are too
     narrow — reconnect with full access to see your existing files." Given
     the granular-consent loop risk above, recommend the message steer the
     user to grant **full access** rather than echoing the opaque API string
     verbatim, so re-consent doesn't silently re-deny the scope and loop.

5. **Generalize to other load-time auth errors / providers?** The user's ideal
   ("if THIS error occurred…") is stated for insufficient-scopes but reads as
   a general pattern. Decide whether the recovery applies to a CLASS (any
   auth-tagged `files:list` failure → evict + reconnect view) and whether
   OneDrive's equivalent Graph insufficient-scope error needs the same
   reclassification ([`onedrive-client.ts`](packages/fs-datasource-engine/src/strategies/onedrive-client.ts)).

6. **Why didn't `checkScopeSufficiency` pre-empt it?** Investigate: the
   recorded `meta.scope` may have looked sufficient while the live grant was
   downgraded, or the proactive check isn't invoked on the `files:list` path.
   If the proactive check can be made reliable it's a cleaner pre-empt — but
   keep the runtime backstop regardless.

## Acceptance criteria (once promoted)

- A runtime 403 "insufficient authentication scopes" (reason
  `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) from
  `files:list` (and other read paths) is classified as an auth error that
  routes to the shared reconnect view — never the dead generic "failed to
  load" state.
- The stale cached credential is evicted (reusing `sync:delete-credentials`)
  so the next reconnect starts clean — the user never hand-deletes
  `credentials.json`.
- The reconnect view shows `Authentication error: <original engine message>`
  with working Reconnect + Remove options.
- Tests: engine unit (403 + `insufficientPermissions` → the chosen auth tag,
  not `provider-error`, carrying the message); renderer (that tag → reconnect
  view with the auth-error copy); fs-sync (auto-evict fires on that tag).
- No regression: genuine provider-errors (quota, domainPolicy) still render
  the generic state; rate-limit / auth-revoked / auth-expired paths unchanged.

## Provenance

- User-reported 2026-06-29: a correctly-authenticated Google Drive datasource
  failed to load with "request had insufficient authentication scopes"; the
  user recovered by manually deleting `credentials.json`. Stated ideal: the
  desktop should evict cached auth + offer reconnect/remove + show
  "Authentication error: &lt;the original error message&gt;".
- Same smoke session as `fix-reconnect-stuck-connecting-button` (the
  reconnect-view recovery/messaging sibling). Both surface the reconnect view +
  messaging as the shared recovery surface — coordinate Q4.
- Verified code: `packages/fs-datasource-engine/src/strategies/googledrive-client.ts`
  (`:2382-2395` 403 → provider-error catch-all; `:991-1008` proactive
  `checkScopeSufficiency` → auth-revoked),
  `apps/desktop/src/renderer/src/features/file-explorer/file-explorer.tsx`
  (`:833-836` only auth-revoked / invalid-datasource route to the reconnect
  view), `services/fs-sync/src/commands/delete-credentials.ts` (reusable
  eviction primitive).
