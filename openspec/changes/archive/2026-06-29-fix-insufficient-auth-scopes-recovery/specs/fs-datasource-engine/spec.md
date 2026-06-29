## ADDED Requirements

### Requirement: Google Drive maps a runtime insufficient-scope 403 to `auth-revoked` with a `scope-insufficient` discriminator

The Google Drive strategy's `normalizeError` SHALL map a runtime 403 whose inner reason token is `insufficientPermissions` OR `ACCESS_TOKEN_SCOPE_INSUFFICIENT` to a `DatasourceError` with `tag === "auth-revoked"` (NOT `provider-error`), `retryable === false`, and `raw === { kind: "scope-insufficient", requiredScope: "https://www.googleapis.com/auth/drive" }`. The thrown error's `message` SHALL preserve the provider's original error message (e.g. "request had insufficient authentication scopes") so a downstream consumer can surface the actual API error to the user.

This is the runtime/operational backstop for the same condition the "Google Drive status / testConnection fail-fast on insufficient scope" requirement detects proactively: both paths converge on the `raw.kind === "scope-insufficient"` discriminator so a single consumer rule recognizes either origin. The runtime path omits `raw.actualScope` (the 403 does not carry the issued scope), whereas the proactive path includes it.

Every OTHER 403 reason (`quotaExceeded`, `dailyLimitExceeded`, `domainPolicy`, `insufficientFilePermissions`, and any unrecognized reason) SHALL continue to map to `tag === "provider-error"`, `retryable === false`, unchanged. The `rateLimitExceeded` / `userRateLimitExceeded` (→ `rate-limited`) and `authError` / `invalidCredentials` (→ `auth-revoked`) 403 branches are unchanged.

#### Scenario: 403 insufficientPermissions reclassifies to auth-revoked + scope-insufficient

- **WHEN** the Drive strategy's `normalizeError` receives a 403 whose first inner error reason is `insufficientPermissions`, carrying the provider message "request had insufficient authentication scopes"
- **THEN** the returned `DatasourceError` has `tag === "auth-revoked"`, `retryable === false`, `raw.kind === "scope-insufficient"`, `raw.requiredScope === "https://www.googleapis.com/auth/drive"`, and its `message` preserves the provider's "request had insufficient authentication scopes" string

#### Scenario: 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT reclassifies identically

- **WHEN** `normalizeError` receives a 403 whose inner reason is `ACCESS_TOKEN_SCOPE_INSUFFICIENT`
- **THEN** the returned `DatasourceError` has `tag === "auth-revoked"`, `retryable === false`, and `raw.kind === "scope-insufficient"`

#### Scenario: Genuine provider-error 403 reasons are not reclassified

- **WHEN** `normalizeError` receives a 403 whose inner reason is `quotaExceeded`, `dailyLimitExceeded`, `domainPolicy`, or `insufficientFilePermissions`
- **THEN** the returned `DatasourceError` has `tag === "provider-error"`, `retryable === false`, and no `raw.kind === "scope-insufficient"` discriminator — the auth reclassification is scoped strictly to the insufficient-scope reasons
