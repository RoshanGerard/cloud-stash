## ADDED Requirements

### Requirement: Reconnect view renders the account-mismatch callout

When an in-place reconnect from the explorer reconnect view fails with `auth-failed` tag `account-mismatch`, the reconnect view SHALL render a full amber "Wrong account" callout below the Reconnect / Remove buttons — read from the failed session's `tag` and `message` rather than the generic "Reconnect failed — please try again." line — and SHALL keep the Reconnect action live for a retry. The callout SHALL show the title "Wrong account" and a body naming the expected account and, when the payload provides it, the account actually signed in as (e.g. "This datasource is connected to {expected}. You signed in as {actual}. Reconnect using {expected} to continue."). Amber is reserved for this recoverable correction; red remains for hard errors. The callout SHALL meet WCAG AA contrast in both light and dark themes and preserve the view's existing `role="alert"` / `aria-live` semantics.

#### Scenario: Reconnect view shows the Wrong account callout on mismatch

- **WHEN** an in-place reconnect resolves to `auth-failed { tag: "account-mismatch", message }`
- **THEN** the reconnect view renders a full amber callout titled "Wrong account" naming the expected account
- **AND** the Reconnect button remains available to retry

#### Scenario: Generic failure copy still applies to other tags

- **WHEN** an in-place reconnect fails with a non-account-mismatch tag (e.g. timeout, provider-error)
- **THEN** the generic "Reconnect failed — please try again." treatment is rendered, unchanged
