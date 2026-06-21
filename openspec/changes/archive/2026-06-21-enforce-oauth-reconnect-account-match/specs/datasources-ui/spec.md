## ADDED Requirements

### Requirement: Datasource card renders an account-mismatch mini-callout

When a reconnect started from the datasource card fails with `auth-failed` tag `account-mismatch`, the card's `AuthErrorBanner` SHALL render a condensed amber "Wrong account" mini-callout — read from the failed session's `tag` and `message` rather than the generic "Reconnect failed" line — and SHALL keep the Reconnect action live for a retry. The callout SHALL show the title "Wrong account" and a body naming the expected account (e.g. "Connect as {expected} to continue."). Amber is reserved for this recoverable correction; red remains for hard errors. The callout SHALL meet WCAG AA contrast in both light and dark themes and preserve the banner's existing `role`/`aria-live` semantics.

#### Scenario: Card shows the Wrong account mini-callout on mismatch

- **WHEN** a reconnect initiated from the card resolves to `auth-failed { tag: "account-mismatch", message }`
- **THEN** the card renders an amber mini-callout titled "Wrong account" naming the expected account from `message`
- **AND** the Reconnect action remains available

#### Scenario: Other auth failures keep the existing banner copy

- **WHEN** a reconnect from the card fails with a non-account-mismatch auth tag
- **THEN** the existing auth-error banner copy is rendered unchanged
