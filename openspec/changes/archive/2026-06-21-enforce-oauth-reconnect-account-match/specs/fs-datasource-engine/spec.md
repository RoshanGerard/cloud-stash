## ADDED Requirements

### Requirement: OAuth `authenticate` captures the account identity into `AuthResult.meta.account`

OAuth-class strategies (`google-drive`, `onedrive`) SHALL request the OIDC `openid` and `email` scopes in the authorize URL (in addition to the provider's resource scope) and, after the authorization-code exchange, SHALL read the issued `id_token`, validate it (`aud` equals the configured `clientId`, `iss` is the provider's issuer, `exp` is in the future), and persist the resulting `{ sub, email }` as `AuthResult.meta.account`. The base persists `meta.account` onto `StoredCredentials.authResult.meta` through the existing credential-write path. `sub` is the durable identity key; `email` is retained for display only. Widening the scope SHALL NOT regress `isScopeSufficient`, which checks for *inclusion* of the resource scope.

#### Scenario: First connect captures the account identity

- **WHEN** a brand-new OAuth datasource completes its authorization-code exchange
- **THEN** the strategy parses the issued `id_token`, and the persisted `StoredCredentials.authResult.meta.account` is `{ sub, email }` taken from the validated token claims

#### Scenario: Resource scope remains sufficient after widening

- **WHEN** a credential is issued with scope that includes both `openid email` and the provider resource scope
- **THEN** `isScopeSufficient` returns true (the added identity scopes do not displace the resource scope)

#### Scenario: Identity read fails closed

- **WHEN** the token response carries no `id_token`, the `id_token` fails claim validation, or it cannot be parsed
- **THEN** the strategy throws a retryable `DatasourceError` and NO credential is persisted (an unverified account is never bound)

### Requirement: Credential refresh preserves the account anchor

`refreshTokenImpl` for OAuth strategies SHALL preserve the existing `meta.account` on the refreshed `AuthResult`. Because a `refresh_token` grant does not return an `id_token`, the strategy SHALL read the current stored `meta.account` and re-emit it on the refreshed credential rather than rebuilding `meta` from app-config alone.

#### Scenario: Refresh keeps the bound account

- **WHEN** an OAuth credential carrying `meta.account = { sub, email }` is refreshed via `refreshCredentials()`
- **THEN** the persisted refreshed `StoredCredentials.authResult.meta.account` is unchanged (`sub` and `email` are preserved)

### Requirement: `createForAuth` accepts an `expectedAccount` anchor and reconnect hard-blocks a `sub` mismatch before persistence

`ClientFactory.createForAuth` SHALL accept an optional `expectedAccount: { sub; email }`, threaded to the OAuth strategy constructor alongside `preAuth`. When `expectedAccount` is present (a reconnect of an already-bound datasource), the strategy SHALL append `login_hint=<expectedAccount.email>` to the authorize URL, and after the code exchange SHALL compare the freshly-authenticated `sub` against `expectedAccount.sub`. On mismatch the strategy SHALL throw `DatasourceError { tag: "account-mismatch" }` carrying the expected `email`, from inside the completion closure — i.e. BEFORE the base persists — so the previously-stored credentials are left intact. When `expectedAccount` is absent, no comparison is performed. The credential store SHALL NOT be consulted by `createForAuth` to obtain the anchor (the anchor is injected by the caller).

#### Scenario: Reconnect with the same account succeeds

- **WHEN** a reconnect carries `expectedAccount.sub` and the re-authenticated `id_token` yields the same `sub`
- **THEN** the new credentials (with refreshed tokens and preserved `meta.account`) are persisted normally

#### Scenario: Reconnect with a different account is hard-blocked before persistence

- **WHEN** a reconnect carries `expectedAccount = { sub: S1, email: E1 }` and the re-authenticated `id_token` yields a different `sub` `S2`
- **THEN** the strategy throws `DatasourceError { tag: "account-mismatch" }` whose payload carries `E1`
- **AND** no `CredentialStore.put` occurs for that datasource — the previously-stored credentials are unchanged

#### Scenario: Reconnect authorize URL steers to the bound account

- **WHEN** `createForAuth` is called with a non-null `expectedAccount`
- **THEN** the authorize URL includes `login_hint=<expectedAccount.email>`

### Requirement: `DatasourceErrorTag` gains `account-mismatch`

The `DatasourceErrorTag` const object SHALL include an `account-mismatch` member denoting a reconnect that authenticated as a different account than the datasource is bound to. The value SHALL be referenced via the const object (never a raw string literal), consistent with the existing const-reference requirement, and SHALL be added to the shared error-tag vocabulary used by the lint rule and drift guard.

#### Scenario: Tag is part of the taxonomy

- **WHEN** code constructs an account-mismatch failure
- **THEN** it references `DatasourceErrorTag.AccountMismatch` (value `"account-mismatch"`) and the error-tag drift guard recognizes the tag as in-vocabulary
