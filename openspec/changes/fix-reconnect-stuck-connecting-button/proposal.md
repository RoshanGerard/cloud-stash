# Proposal: Wrong-account OAuth reconnect strands the user — stuck "Connecting…" button + misleading "credentials missing/invalid" message — when the attempt dead-ends

**Status**: Stub. Spawned 2026-06-29 from a real-provider reconnect smoke
(the `enforce-oauth-reconnect-account-match` §9.4 wrong-account flow that
was deferred to `PENDING_TC.MD` and never run end-to-end). User-reported.

## Why

**Repro.** Click *Explore* on a Google Drive datasource whose credentials
need re-registering → the explorer shows the shared reconnect view
(`<InvalidDatasourceState>`). Click *Reconnect* → the browser opens Google
sign-in. Pick the **wrong** Google account (one that is NOT an approved
test user while the OAuth app is in **Testing** publishing status). Google
hard-blocks at the consent screen with:

> CloudStash has not completed the Google verification process. The app is
> currently being tested, and can only be accessed by developer-approved
> testers. … **Error 403: access_denied**

Back in the app, the reconnect view shows the generic body copy —

> This datasource needs reconfiguring. Its connection details are missing
> or invalid. Sign in again or remove the datasource and add it back.

— with the primary button **stuck on a greyed-out "Connecting…"** and no
way to retry or abandon the attempt.

**Expected.** Two things, both user-requested:

1. **Don't strand the user on a dead button.** When the reconnect attempt
   does not complete, the view must surface an actionable **"Try Again"**
   button so the user can restart the reconnect (and/or remove the
   datasource) — never a permanently-disabled "Connecting…".
2. **Show an accurate message for the wrong-account attempt.** The current
   generic copy — "Its connection details are missing or invalid" — is
   MISLEADING here: the stored credentials are not missing or invalid; the
   user signed in with the wrong / non-permitted account and the sign-in was
   denied or never completed. The view must say what actually happened
   (sign-in didn't complete / access denied / wrong account) and point the
   user to retry with the account this datasource is connected to. How
   precise that message can be is bounded by the signal the app actually has
   — see Q6.

**Root cause (hypothesis — confirm during investigation).** Two layers
compound:

1. **The dead-end never calls back.** Google's *Testing*-mode
   `access_denied` is a terminal browser page — Google does **not** redirect
   to the loopback `redirect_uri` with `error=access_denied`. So the
   service's loopback server
   ([`services/fs-sync/src/oauth/loopback-broker.ts:371-478`](services/fs-sync/src/oauth/loopback-broker.ts#L371-L478))
   never receives a `/callback`, the broker session never terminates, and
   **no `auth-failed` / `auth-timeout` event is emitted** for the
   correlation. The renderer's `useAuthSession(correlationId)` therefore
   stays `status: "pending"` indefinitely. Note the logic that pins this to
   the dead-end: ANY callback that arrives — even an error one — produces a
   terminal event (state-mismatch → `auth-revoked`; the empty-code
   `completeWith("")` → `provider-error`). So a *permanently* stuck
   "Connecting…" implies no callback arrived at all. This is why the
   renderer-side recovery (Q1a live Cancel) is the load-bearing fix
   regardless of broker behavior; the broker `error=` handling (Q2) is a
   robustness add-on, not the cure.

2. **The reconnect view has no recovery affordance while pending.** In
   [`apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx`](apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx),
   `isWaiting = correlationId !== null && sessionState.status === "pending"`
   ([:81-82](apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx#L81-L82))
   drives both the label (`reconnectLabel = isWaiting ? "Connecting…" : "Reconnect"`,
   [:148](apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx#L148))
   and `disabled={isWaiting}`
   ([:241](apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx#L241)).
   While pending there is **no Cancel/Try-Again path** — unlike the
   add-new-datasource OAuth form, which swaps to a real "Retry" button on
   any failure
   ([`oauth-form.tsx:271-273`](apps/desktop/src/renderer/src/features/datasources/credential-forms/oauth-form.tsx#L271-L273)).
   And because the explorer reconnect view is a full-page state (no dialog
   to close), the user cannot even unmount the form to trigger the
   `authenticateCancel` cleanup the dialog path relies on.

Note this `access_denied` dead-end is a DIFFERENT path from the in-app
account-mismatch hard-block. Account-mismatch only fires AFTER a successful
token exchange (the broker maps a `DatasourceError{account-mismatch}` to
`auth-failed{account-mismatch}` at
[`loopback-broker.ts:444-469`](services/fs-sync/src/oauth/loopback-broker.ts#L444-L469),
which the reconnect view already renders as the amber "Wrong account"
callout). The 403/`access_denied` repro never reaches the exchange, so that
path — and its recovery UI — is never exercised.

## Out of scope

- Taking the Google OAuth app out of *Testing* publishing status. That is a
  provider-console / verification concern, not an app fix. The app must
  degrade gracefully regardless of the provider's consent outcome.
- Re-designing the reconnect view's overall layout. The failure/recovery
  MESSAGING is in scope (per Q6 — the misleading "missing or invalid" copy
  must be corrected for the interrupted-reconnect case), but the default
  prompt's structure, icon, and Remove affordance stay as-is.
- The account-mismatch (post-exchange) amber-callout UI. It is implemented
  and unit-tested, and its terminal `auth-failed{account-mismatch}` event
  lets its button recover — so it is out of scope here, though note its own
  end-to-end smoke was ALSO deferred (the same §9.4 gap that surfaced this
  bug). This change only addresses the never-completes / dead-end path.

## Open questions (resolve during `/opsx:propose`)

1. **Recovery-while-pending vs recovery-on-terminal.** The dead-end may
   never emit a terminal event, so a fix that only reacts to
   `failed`/`timeout` would still strand the user. Options:
   - (a) Add an explicit **Cancel** affordance that is live WHILE pending —
     calls `window.api.sync.authenticateCancel({ correlationId })`, resets
     `correlationId` to `null`, and returns the button to an actionable
     "Try Again" / "Reconnect". Covers the dead-end directly.
   - (b) Rely on the broker's timeout to eventually emit `auth-timeout`,
     then show "Try Again". Verify the timeout fires for the reconnect
     correlation (Q3) — and note that up to ~5 minutes of a dead button is
     poor UX even if it does.
   - (c) Both: a live Cancel for immediate recovery, plus correct
     terminal-state handling as a backstop.
   - **Recommend (c).** Immediate user control + a backstop for the case
     where the user waits.

2. **Should the broker detect an `error=` callback param?** Some providers
   (and some Google configurations) DO redirect back with
   `?error=access_denied&state=…`. The current handler
   ([:388-418](services/fs-sync/src/oauth/loopback-broker.ts#L388-L418))
   only checks `state`, then passes a possibly-empty `code` into
   `completeWith("")` — a doomed exchange that surfaces as a generic
   `provider-error` rather than a clear "access denied". Recommend the
   promoted change add an `error` check that emits a typed
   `auth-failed` (clear "access denied / consent declined" copy) instead of
   attempting an empty-code exchange. Decide whether this belongs in THIS
   change or a sibling `fs-sync` change — it is a service-side robustness
   gap orthogonal to the renderer button.

3. **Does `auth-timeout` actually reach the reconnect correlation?** Verify
   the broker's ~5-minute ceiling emits `auth-timeout` for a session
   started via `authenticateStart({ providerId, datasourceId })` and that
   `useAuthSession` surfaces it. If it does, `isFailed` already covers
   `timeout` ([:84-87](apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx#L84-L87))
   and the button recovers after the ceiling — making the live Cancel (Q1a)
   a UX improvement rather than the sole recovery path.

4. **Button vocabulary.** User asked for **"Try Again"**. The add-new OAuth
   form uses **"Retry"** ([`oauth-form.tsx:272`](apps/desktop/src/renderer/src/features/datasources/credential-forms/oauth-form.tsx#L272)).
   Pick ONE label for both surfaces (frontend↔frontend vocabulary
   consistency). Recommend aligning on "Try Again" per the user, or "Retry"
   per the existing form — decide and apply to both.

5. **Scope split.** Is this renderer-only (Q1 + Q4 + Q6 dead-end copy) or
   renderer + service (Q1 + Q2 + Q4 + Q6 precise copy)? If the broker
   `error=` handling (Q2) is included, the change spans `file-explorer` and
   `fs-sync-service` capabilities; if deferred, it is a `file-explorer`-only
   renderer fix. Recommend scoping the renderer recovery affordance +
   corrected dead-end copy as the primary deliverable and deciding Q2 at
   propose time (it may warrant its own stub).

6. **Message fidelity for the wrong-account case (bounded by available
   signal).** The "proper message" the user asks for is limited by what the
   app can actually know:
   - **Dead-end (no callback — the live repro):** the app has NO cause
     signal; it cannot distinguish wrong-account from declined-consent from a
     closed tab. The honest message is accurate-but-generic: e.g. "Sign-in
     didn't complete. If you chose a different account or weren't granted
     access, try again with the account this datasource is connected to." It
     must NOT claim "credentials missing or invalid."
   - **`error=` callback (depends on Q2):** if the broker detects
     `error=access_denied` / `consent_required`, the renderer CAN show a
     precise "Access was denied — the account you chose may not be permitted"
     message.
   - **Post-exchange account-mismatch:** already precise (the amber "Wrong
     account" callout naming both accounts) — unchanged.
   Decide the exact copy per sub-case and where it renders (replace vs.
   augment the default "needs reconfiguring" body). Recommend gating the
   misleading "missing or invalid" line so it shows ONLY for a genuine
   missing-credential state — never for an interrupted/denied reconnect.

## Acceptance criteria (once promoted)

- Starting an OAuth reconnect from `<InvalidDatasourceState>` and then NOT
  completing it (provider dead-end, declined consent, or abandonment) never
  leaves the user on a permanently-disabled "Connecting…" button.
- The view exposes an actionable recovery control (live Cancel and/or a
  terminal "Try Again"/"Retry" button per Q1/Q4) that resets the session
  and lets the user restart the reconnect or remove the datasource.
- An interrupted / denied / wrong-account reconnect surfaces an ACCURATE
  message (per Q6) — never the misleading "connection details are missing or
  invalid" copy, which is reserved for a genuine missing-credential state. A
  renderer test asserts the corrected copy for the no-callback case.
- If the broker `error=` handling is in scope (Q2): an `access_denied`
  callback emits a typed `auth-failed` with clear copy instead of a generic
  `provider-error` from an empty-code exchange — with a unit test on the
  broker callback handler.
- A renderer composite/unit test covers: reconnect started → session stuck
  `pending` → user can recover via the new affordance → button returns to an
  actionable state.
- No regression in the existing account-mismatch amber-callout path or the
  add-new-datasource OAuth form's Retry behavior.
- Button vocabulary is consistent across the reconnect view and the
  add-new OAuth form (Q4). WCAG AA unchanged; the recovery control is
  keyboard-reachable and announced.

## Provenance

- User-reported on 2026-06-29 during a real-provider reconnect smoke of a
  Google Drive datasource. External symptom: Google **Error 403:
  access_denied** ("CloudStash has not completed the Google verification
  process … developer-approved testers"). In-app symptom: misleading generic
  "needs reconfiguring / connection details are missing or invalid" copy
  (the credentials are NOT actually missing) + a greyed-out, stuck
  **"Connecting…"** button with no recovery.
- This is the first real exercise of the wrong-account reconnect flow:
  `enforce-oauth-reconnect-account-match` §9.4 (real-provider wrong-account
  reconnect on Google Drive + OneDrive) was **deferred to `PENDING_TC.MD`**
  at merge (2026-06-21) and never run. The amber account-mismatch callout
  was built and unit-tested, but the *Testing*-mode `access_denied`
  dead-end — which preempts the token exchange the account-mismatch check
  depends on — was outside that change's tested surface.
- Related code: `apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx`
  (reconnect view state machine),
  `apps/desktop/src/renderer/src/features/datasources/credential-forms/oauth-form.tsx`
  (the add-new path's working Retry affordance, for parity),
  `services/fs-sync/src/oauth/loopback-broker.ts` (callback handler;
  `error=` param not inspected).
