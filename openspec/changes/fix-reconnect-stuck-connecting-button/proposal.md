# Proposal: Reconnect view recovers from a dead-ended OAuth reconnect with "Try Again" + accurate copy

## Why

When a user clicks **Reconnect** in the explorer reconnect view
(`<InvalidDatasourceState>`) and the OAuth flow does not complete — the live
repro is Google's *Testing*-mode `access_denied` 403, a browser dead-end that
never calls back the loopback `redirect_uri` — the renderer's
`useAuthSession(correlationId)` stays `pending`, so the view leaves the user on
a **permanently-disabled "Connecting…" button** with the misleading static body
"Its connection details are missing or invalid." There is no way to retry or
abandon the attempt short of the broker's 5-minute timeout. The user must see an
actionable **"Try Again"** and an accurate message instead.

This change also **owns the shared reconnect-view message-rendering path** that
the sibling change `fix-insufficient-auth-scopes-recovery` extends with a runtime
auth-error case — so the recovery + messaging surface is designed once here.

## What Changes

- The reconnect view exposes a **live Cancel** control while a reconnect is
  `pending` — it calls `window.api.sync.authenticateCancel({ correlationId })`,
  resets the session, and returns the primary action to an actionable
  **"Try Again"**. This gives immediate escape from a dead-end; the broker's
  existing 5-minute `auth-timeout` remains the backstop.
- On any terminal failure (`cancelled` / `failed` / `timeout`) the primary
  button reads **"Try Again"** (not "Reconnect"), and the inline copy is accurate
  to the outcome — for a dead-end/timeout, "Sign-in didn't complete. Try again
  with the account this datasource is connected to." — never the blanket
  "connection details are missing or invalid" as the failure explanation.
- The existing amber **account-mismatch** "Wrong account" callout is preserved
  unchanged (it is sourced from the auth-session `tag`, not the files envelope).
- The inline message region becomes a single rendering **slot** that the sibling
  change extends with an auth-error headline + detail — no contract field or
  engine/fs-sync code in this change.

Out of scope (decisions recorded in `design.md`): engine error classification,
fs-sync credential eviction, and the `FilesErrorEnvelope.authErrorKind` field +
scope headline (all in the sibling change); broker `error=` callback detection
(deferred follow-up); aligning the add-new OAuth form's "Retry" label to
"Try Again" (deferred — would expand into the `datasources-ui` capability for a
cosmetic gain).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `file-explorer`: the "Datasource reconnect runs in-place via
  `sync.authenticateStart`" requirement changes — a live Cancel during pending,
  a "Try Again" terminal label, accurate outcome copy (no blanket
  "missing/invalid" line on a failed reconnect), the preserved account-mismatch
  callout, and a single extensible message slot.

## Impact

- **Code (renderer-only):**
  `apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx`
  (recovery state machine + message rendering) and its tests.
- **No contract / IPC / wire changes.** Fully backward-compatible. The optional
  `FilesErrorEnvelope.authErrorKind` field is introduced by the sibling change,
  not here.
- **Guardrails:** `scripts/motion-budget.test.ts` (no `animate-spin`), WCAG AA
  unchanged.

## Provenance

- User-reported on 2026-06-29 during a real-provider reconnect smoke of a Google
  Drive datasource. External symptom: Google **Error 403: access_denied**
  ("CloudStash has not completed the Google verification process … developer-
  approved testers"). In-app symptom: misleading "needs reconfiguring / connection
  details are missing or invalid" copy + a greyed-out, stuck **"Connecting…"**
  button with no recovery.
- First real exercise of the wrong-account reconnect flow:
  `enforce-oauth-reconnect-account-match` §9.4 (real-provider wrong-account
  reconnect) was **deferred to `PENDING_TC.MD`** at merge (2026-06-21) and never
  run; the *Testing*-mode `access_denied` dead-end was outside that change's
  tested surface.
- **Sibling change** `fix-insufficient-auth-scopes-recovery` (same smoke
  session): a correctly-authenticated datasource hitting a runtime "insufficient
  authentication scopes" 403 also lands in a no-recovery dead end. Both converge
  on this reconnect view + its message-rendering path; this change provides the
  slot that one consumes. Sequencing: this change lands first; the sibling is
  proposed against canonical after this one syncs.
