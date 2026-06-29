## Context

The shared explorer reconnect view `<InvalidDatasourceState>`
([`apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx`](../../../apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx))
renders for both `auth-revoked` and `invalid-datasource` files-error tags
(unify-datasource-reconnect-view). When the user clicks **Reconnect** and the
OAuth flow does NOT complete — the live repro is Google's *Testing*-mode
`access_denied` 403, a browser dead-end that never calls back the loopback
`redirect_uri` — the service-side broker session never terminates, so the
renderer's `useAuthSession(correlationId)` stays `status: "pending"`. Today the
view binds `disabled={isWaiting}` and relabels the primary button to
"Connecting…", leaving the user on a **permanently-disabled button** with the
misleading static body "Its connection details are missing or invalid." The
add-new OAuth form already does this better — it swaps to a "Retry" button on
any failure ([`oauth-form.tsx:271-273`](../../../apps/desktop/src/renderer/src/features/datasources/credential-forms/oauth-form.tsx#L271-L273)).

This change makes the reconnect view recover gracefully and tell the truth. It
also **owns the shared message-rendering path** that the sibling change
`fix-insufficient-auth-scopes-recovery` (Change 2) extends with a runtime
auth-error case — Change 2 routes its error INTO this view. Renderer-only; the
broker's existing 5-minute `auth-timeout`
([`loopback-broker.ts:566-570`](../../../services/fs-sync/src/oauth/loopback-broker.ts#L566-L570))
is verified to fire for reconnect sessions and remains the eventual backstop.

## Goals / Non-Goals

**Goals:**
- A reconnect that does not complete never strands the user on a disabled
  "Connecting…" button — a **live Cancel** while pending plus a terminal
  **"Try Again"** give immediate and eventual recovery.
- A **unified message-rendering path** keyed on *(files-error envelope +
  auth-session state)* that renders accurate copy instead of the blanket
  "credentials missing or invalid", and is structured so Change 2 can add an
  auth-error case without re-plumbing.
- Button vocabulary "**Try Again**" aligned across the reconnect view AND the
  add-new OAuth form (frontend↔frontend consistency).

**Non-Goals:**
- Engine error classification, fs-sync credential eviction, and the
  `FilesErrorEnvelope.authErrorKind` discriminator field + provider-parameterized
  scope headline — ALL in the sibling change `fix-insufficient-auth-scopes-recovery`
  (Change 2). This change adds **no contract field** and **no engine/fs-sync
  code**.
- Broker `error=` callback detection — deferred follow-up. The live Cancel makes
  it non-essential, and Google's *Testing*-mode dead-end is a no-callback case
  where `error=` would never fire anyway.
- Reconnect-view layout/structure redesign — only the recovery state machine and
  message copy change; the icon, heading, and Remove affordance stay.

## Decisions

### D1 — Live Cancel while pending + terminal "Try Again" (both, not either)
While a reconnect is pending, the view exposes a **Cancel** control that calls
`window.api.sync.authenticateCancel({ correlationId })`, resets `correlationId`
to `null`, and returns the primary button to an actionable **"Try Again"**. On
a terminal session state with **no specific cause** (`failed` / `timeout` /
`cancelled`, **excluding `account-mismatch`**) the primary button is
**"Try Again"**, never a disabled "Connecting…".

*account-mismatch is the one terminal exception:* it keeps its live **"Reconnect"**
label (not "Try Again"). Two reasons: (1) the `account-mismatch` callout copy
already says "Reconnect using {email} to continue", so "Reconnect" reads as the
matching CTA; (2) the just-shipped `enforce-oauth-reconnect-account-match`
capability's canonical tests pin this button to `/^reconnect$/i` — relabelling it
would be a test-coverage regression of a shipped contract. The reconnect view is
the only surface where a terminal failure can carry the `account-mismatch` tag
(it is sourced from the auth-session, not the files envelope).

*Why both:* the dead-end emits no prompt terminal event, so terminal-only
recovery would still strand the user until the 5-minute `auth-timeout`. *Why not
timeout-only:* 5 minutes of a dead button is unacceptable UX. The live Cancel is
the load-bearing fix; the verified 5-min `auth-timeout` is the backstop.

### D2 — "Try Again" vocabulary in the reconnect view (OAuth-form alignment deferred)
The reconnect view's recovery button reads **"Try Again"** (the surface with the
reported bug). *Scope refinement surfaced while writing deltas:* the add-new
OAuth form's "Retry" label is spec'd in the **datasources-ui** capability
([`datasources-ui/spec.md`](../../specs/datasources-ui/spec.md) OAuth-form
scenarios), so aligning it would expand this change into a second capability for
a purely cosmetic gain. Deferred to a noted consistency follow-up; this change
stays single-capability (file-explorer). The reconnect view and the OAuth form
will briefly differ ("Try Again" vs "Retry") until that follow-up.

### D3 — Unified message-rendering path
ONE rendering path keyed on *(files-error envelope + auth-session state)*. This
change implements four cases; Change 2 adds a fifth:
- **(a) genuine missing-credential** → the generic "needs reconfiguring" copy
  (reserved strictly for a real missing/invalid credential state).
- **(b) real envelope message** → render `FilesErrorEnvelope.message` (already
  present on the contract) instead of the blanket "missing or invalid" line when
  the initiating files error carries a real message.
- **(c) account-mismatch** → the existing amber "Wrong account" callout, sourced
  from the auth-session `tag` (NOT the files envelope). Unchanged — must not
  regress.
- **(d) dead-end / interrupted reconnect** (session `timeout`/`cancelled`, no
  specific cause) → honest copy: "Sign-in didn't complete. Try again with the
  account this datasource is connected to." Never "credentials missing or
  invalid."
- **(e, Change 2) auth-error / scope-insufficient** → the path is built to host a
  provider-parameterized actionable headline + "Authentication error: \<message\>"
  detail; Change 2 supplies the `authErrorKind` discriminator and headline copy.

### D4 — Renderer-only; the contract field lives with its producer (Change 2)
Change 1 owns the message-rendering **path** (the component state machine that can
render multiple message cases and the recovery affordance); Change 2 adds the
auth-error **case** plus the `FilesErrorEnvelope.authErrorKind` field that enables
it. Rationale: a contract field with no producer in the same change is dead
weight, and keeping the field with its producer means Change 1 has zero forward
dependency and Change 2 is self-contained. *Alternative considered:* Change 1
defines a dormant `authErrorKind` (advisor's parallel-mode suggestion). Rejected
for the chosen **sequential** plan (Change 1 lands and syncs to canonical before
Change 2 is proposed), which removes the forward-reference that made a dormant
field attractive.

### D5 — Recovery affordance shape is a Visual-direction decision
The exact placement/states of Cancel vs "Try Again" (separate control vs the
primary button toggling) and the dead-end copy wording are finalized in the
mandatory visual-refinement pass and recorded under `## Visual direction` before
`/opsx:apply`.

### D6 — Remove stays enabled during pending; the view cancels its session on unmount
Consistent with the Option-B "no greyed button" direction, the **Remove** button
stays enabled while a reconnect is `pending`. To make that safe — and to close
the general gap that navigating away from a pending reconnect leaves a dangling
loopback session until the 5-minute timeout — the component gains an
**unmount-cancel** effect mirroring the add-new OAuth form
([`oauth-form.tsx:86-95`](../../../apps/desktop/src/renderer/src/features/datasources/credential-forms/oauth-form.tsx#L86-L95)):
on unmount with a live `correlationId`, it calls
`window.api.sync.authenticateCancel({ correlationId })` (idempotent). Clicking
Remove unmounts the explorer, so this is what keeps Remove-during-pending from
stranding a session. *Alternative considered:* disable Remove during pending —
rejected because it reintroduces a greyed button and forces a two-step
"Cancel, then Remove". This was a stub Open Question; promoted to a decision
because enabling Remove during pending requires it.

## Risks / Trade-offs

- **Live-cancel race with an in-flight `authenticateStart`** → the click handler
  guards on the pending/`correlationId` state and `authenticateCancel` is
  idempotent (mirrors the add-new OAuth form's unmount cleanup contract).
- **Navigating away / Remove during a pending reconnect could leave a dangling
  loopback session** → handled by D6's unmount-cancel effect (calls
  `authenticateCancel` on unmount with a live `correlationId`); also covered as a
  backstop by the broker's 5-min `auth-timeout`.
- **Vocabulary change touches the add-new OAuth form** → label-only; covered by
  the existing form tests; no behavior change.
- **account-mismatch callout regression risk** → explicit non-regression test;
  the amber callout is sourced from the auth-session tag and is left structurally
  intact.

## Migration Plan

None. Renderer-only, fully backward-compatible — no data, schema, IPC, or wire
contract changes in this change. (The optional `authErrorKind` envelope field is
introduced by Change 2.)

## Open Questions

- **Broker `error=` callback detection** — deferred to a separate fs-sync
  follow-up; not required for this change's recovery.

## Visual direction

Converged via the visual-refinement pass (companion mockup approved 2026-06-29).
The reconnect view stays a centered full-replace state (AlertTriangle 40px
`text-destructive`, 15px semibold headline "This datasource needs reconfiguring").
The recovery affordance changes per session phase:

- **Initial (pre-attempt) — unchanged.** Generic body ("Its connection details
  are missing or invalid…") + primary **Reconnect** (`Button` default) + ghost
  **Remove datasource** (`variant="ghost" size="sm"` `text-destructive`).
- **Pending — no greyed button (chosen over keeping a disabled "Connecting…").**
  "Connecting…" is an **announced status line** ("Connecting… — finish signing in
  to {Provider} in your browser.", `role="status"` `aria-live="polite"`, NO
  spinner — `animate-spin` is forbidden by the motion-budget guard) that replaces
  the body. The button row is an outline **Cancel** (`variant="outline"`) +
  ghost **Remove**. There is never a disabled/greyed button on screen.
- **Terminal failure** (`cancelled`/`failed`/`timeout`, no specific cause) — the
  accurate dead-end line ("Sign-in didn't complete. Try again with the account
  this datasource is connected to.", `text-destructive`) **replaces** the static
  body; the button row is primary **Try Again** (`Button` default) + ghost
  **Remove**.
- **Account-mismatch — unchanged.** The amber "Wrong account" callout
  (`border-amber-300 bg-amber-50`, dark-mode variants) renders below a live
  primary **Reconnect** + ghost **Remove**, exactly as today (the one terminal
  case that keeps the **"Reconnect"** label rather than "Try Again" — see D1).
- **Auth-error slot (container built here; sibling supplies copy).** A
  destructive-palette callout mirroring the amber callout's structure but
  red-keyed (`border-destructive/40 bg-destructive/5`, left accent
  `border-l-2 border-destructive`): a provider-parameterized headline (e.g.
  "{Provider} needs full-access permission") + a smaller, lower-emphasis
  "Authentication error: \<message\>" detail line. Defined now as an empty
  container; `fix-insufficient-auth-scopes-recovery` fills the headline + detail.

**Vocabulary/idiom:** shadcn `Button` variants — `outline` = Cancel, `default` =
Try Again / Reconnect, `ghost`+`text-destructive` = Remove. **A11y:** the status
line is a `role="status"` `aria-live="polite"` region; the always-present
actionable control is keyboard-reachable and lands in tab order after the
toolbar; destructive-red and amber callout text pass WCAG AA on their tinted
backgrounds; icons `aria-hidden`. No new motion.
