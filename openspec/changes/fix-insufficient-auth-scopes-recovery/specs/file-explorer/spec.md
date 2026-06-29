## ADDED Requirements

### Requirement: Reconnect view renders the scope-insufficient auth-error callout

When the files-error envelope that routed the explorer to the shared reconnect view carries `authErrorKind === "scope-insufficient"` (an insufficient-scope auth failure surfaced by `files:list` — distinct from the auth-session `account-mismatch` tag), the reconnect view SHALL render a destructive-palette "auth-error" callout filling the slot the "Datasource reconnect runs in-place" requirement reserves. The callout SHALL show:

- a provider-parameterized steering **headline** derived from the provider display name — "{Provider} needs full-access permission" (e.g. "Google Drive needs full-access permission") — that tells the user the corrective action (grant full access on reconnect), breaking the granular-consent re-deny loop; and
- a lower-emphasis **detail** line "Authentication error: \<message\>" rendering the engine's original error `message` verbatim.

The callout is sourced from the files-error envelope (`authErrorKind` + `message`) threaded through the component's props — NOT parsed from the message string, and NOT sourced from the auth-session. Red is reserved for this hard auth error (mirroring the amber callout's reservation for the recoverable wrong-account correction). The callout SHALL render BELOW the action button row (structurally mirroring the amber account-mismatch callout's placement). The view's live **Reconnect** and ghost **Remove** affordances SHALL remain available (the routing tag is the initial `auth-revoked`, not a terminal session failure, so the primary action keeps the "Reconnect" label). The callout SHALL be motion-free (no `animate-spin`, per the `scripts/motion-budget.test.ts` guardrail), meet WCAG AA contrast in light and dark themes, mark decorative icons `aria-hidden`, and preserve the view's existing `role` / `aria-live` semantics.

When the auth-error callout renders, the reconnect view SHALL suppress the generic "Its connection details are missing or invalid" body line — the credential is present but under-scoped, so that line would contradict the callout. The heading "This datasource needs reconfiguring" remains; the callout carries the accurate explanation.

The auth-error callout SHALL render only when no reconnect is in progress and no wrong-account session failure is showing (i.e. NOT while the session is `pending`, and NOT while the auth-session `account-mismatch` callout is showing) — those states take precedence so at most one callout is visible at a time.

When the envelope does NOT carry `authErrorKind === "scope-insufficient"`, the reconnect view SHALL NOT render the auth-error callout — the existing initial / dead-end / account-mismatch copy paths are unchanged.

#### Scenario: scope-insufficient envelope renders the auth-error callout with steering headline + raw detail

- **WHEN** `window.api.files.list` rejects with `{ error: { tag: "auth-revoked", authErrorKind: "scope-insufficient", message: "request had insufficient authentication scopes" } }` for an OAuth datasource `{ providerId: "google-drive", datasourceId: "ds-1" }`, and the explorer renders the shared reconnect view
- **THEN** a destructive-palette auth-error callout renders showing the headline "Google Drive needs full-access permission" and the detail line "Authentication error: request had insufficient authentication scopes", and the live Reconnect + Remove buttons remain present

#### Scenario: provider display name parameterizes the headline

- **WHEN** the same scope-insufficient envelope routes the reconnect view for a datasource whose provider display name is "Google Drive"
- **THEN** the callout headline names that provider — "Google Drive needs full-access permission" — derived from the provider descriptor, not hard-coded

#### Scenario: scope-insufficient suppresses the misleading generic body line

- **WHEN** the reconnect view renders the scope-insufficient auth-error callout
- **THEN** the generic "Its connection details are missing or invalid" body line is NOT shown (the heading and the callout together carry the accurate story)

#### Scenario: auth-revoked without scope-insufficient does not render the auth-error callout

- **WHEN** the reconnect view is reached via an `auth-revoked` envelope that carries NO `authErrorKind` (e.g. a revoked grant)
- **THEN** no auth-error callout renders; the existing reconnect copy and affordances are unchanged
