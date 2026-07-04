## ADDED Requirements

### Requirement: OneDrive OAuth flow is implemented on `@azure/msal-node` with PKCE (S256)

The `OneDriveClient` SHALL implement its OAuth authorization-code flow via `@azure/msal-node`'s `PublicClientApplication`. `doAuthenticateImpl` SHALL mint the authorize URL via `getAuthCodeUrl`, and the returned `OAuthIntent.completeWith(code)` SHALL exchange the code via `acquireTokenByCode`. The authorize URL SHALL carry a PKCE `code_challenge` with `code_challenge_method=S256`; the matching `code_verifier` SHALL be generated per authenticate attempt via MSAL's `CryptoProvider`, captured only in the `completeWith` closure (never stored on the instance, persisted, or logged), and threaded into `acquireTokenByCode`. The `redirectUri` and the resource scope set SHALL be identical between `getAuthCodeUrl` and `acquireTokenByCode`. The strategy SHALL NOT use `acquireTokenInteractive` (which would open its own loopback listener and conflict with the broker). The `OAuthIntent` shape returned to the broker SHALL remain `{ kind: "oauth", authorizeUrl, completeWith }`, and the strategy SHALL request the resource scopes `Files.ReadWrite.All` and `User.Read` (the reserved OIDC scopes `openid`/`profile`/`offline_access` SHALL NOT be passed, as MSAL manages them).

#### Scenario: Authorize URL carries an S256 PKCE challenge

- **WHEN** `client.authenticate()` is invoked on a OneDriveClient constructed via `createForAuth` with an injected MSAL client
- **THEN** the returned intent has `kind === "oauth"`, and its `authorizeUrl` carries `code_challenge` with `code_challenge_method=S256`, and the URL's `redirect_uri` equals the loopback `redirectUri` supplied at construction

#### Scenario: completeWith exchanges the code via acquireTokenByCode threading the verifier

- **WHEN** the intent's `completeWith("fake-auth-code")` is invoked
- **THEN** the injected MSAL client's `acquireTokenByCode` is called exactly once with `code === "fake-auth-code"`, the same `codeVerifier` whose challenge appeared on the authorize URL, and the same `redirectUri` and resource scopes used to build the URL

### Requirement: OneDrive persists the MSAL token cache in `meta.msalCache` via the single credential write

The `OneDriveClient` SHALL treat MSAL's serialized token cache as the durable credential artifact. Before a token operation it SHALL `deserialize` any stored `authResult.meta.msalCache` blob into the `PublicClientApplication`'s token cache; after the operation it SHALL `serialize` the cache and return the blob on `AuthResult.meta.msalCache`. The strategy SHALL NOT register an MSAL `ICachePlugin`; the engine's existing single `CredentialStore.put` (via `decorateIntent` on exchange and the returned `AuthResult` on refresh) SHALL remain the sole writer of the credential record. The strategy SHALL also mirror the MSAL result's current access token onto the top-level `authResult.accessToken` for generic consumers, while the serialized cache blob remains the source of truth for refresh.

#### Scenario: Exchange persists the serialized MSAL cache blob through one write

- **WHEN** a fresh authorization-code exchange completes via `completeWith`
- **THEN** the persisted `StoredCredentials.authResult.meta.msalCache` equals the string returned by the MSAL token cache's `serialize()`, `authResult.accessToken` equals the access token from the MSAL result, and `CredentialStore.put` has been called exactly once

#### Scenario: A stored cache blob is deserialized before a token operation

- **WHEN** a OneDriveClient is constructed from `StoredCredentials` carrying `meta.msalCache` and a token operation runs
- **THEN** the MSAL token cache's `deserialize` is called with that blob before `acquireTokenSilent` is invoked

### Requirement: OneDrive token refresh is silent via MSAL and surfaces reconnect only when unrecoverable

`OneDriveClient.refreshTokenImpl` SHALL refresh via `acquireTokenSilent({ account, scopes })`, resolving the account from the deserialized cache via `getAccountByHomeId(meta.account.homeAccountId)`. On success it SHALL return an `AuthResult` carrying the re-serialized `meta.msalCache` and the refreshed access token, preserving the existing `meta.account` anchor. When MSAL raises `InteractionRequiredAuthError` (the refresh token is expired, revoked, or otherwise unusable), the strategy SHALL throw a retryable `DatasourceError { tag: "auth-expired" }` so the existing auth-expired / reconnect path engages. Single-flight coordination SHALL remain provided by the base class.

#### Scenario: Silent refresh returns a new token without user interaction

- **WHEN** `refreshCredentials()` runs and the injected MSAL client's `acquireTokenSilent` resolves with a new access token
- **THEN** the persisted refreshed `authResult.accessToken` is the new token, `authResult.meta.msalCache` is the re-serialized cache, `authResult.meta.account` is unchanged, and no authorize URL is produced

#### Scenario: Unrecoverable refresh maps to auth-expired

- **WHEN** `refreshCredentials()` runs and `acquireTokenSilent` rejects with an MSAL `InteractionRequiredAuthError`
- **THEN** `refreshCredentials()` rejects with `DatasourceError { tag: "auth-expired", retryable: true }` and `CredentialStore.put` is NOT called with any new value

### Requirement: OneDrive captures the account identity from MSAL's validated `id_token` and persists `homeAccountId`

On the authorization-code exchange, `OneDriveClient` SHALL read `sub` and `email` from the `acquireTokenByCode` result's validated `idTokenClaims` (MSAL performs issuer / audience / signature validation) rather than hand-decoding the `id_token`. The persisted `authResult.meta.account` SHALL be `{ sub, email, homeAccountId }`, where `homeAccountId` is the MSAL account's home identifier used for later silent-refresh lookup and `email` defaults to `""` when the claim is absent. The same-account reconnect guard SHALL be preserved: when `createForAuth` supplied an `expectedAccount` and the freshly-read `sub` differs from `expectedAccount.sub`, the strategy SHALL throw `DatasourceError { tag: "account-mismatch" }` BEFORE any credential is persisted. `sub` SHALL remain the sole comparison key; `homeAccountId` SHALL NOT be used for the same-account comparison.

#### Scenario: Exchange persists sub, email, and homeAccountId from validated claims

- **WHEN** a first-connect exchange completes and the MSAL result carries `idTokenClaims` with `sub: "S1"`, `email: "u@x"` and an account with `homeAccountId: "H1"`
- **THEN** the persisted `authResult.meta.account` is `{ sub: "S1", email: "u@x", homeAccountId: "H1" }`

#### Scenario: Reconnect as a different account hard-blocks before persistence

- **WHEN** a reconnect carries `expectedAccount.sub === "S1"` and the exchange's validated `idTokenClaims.sub` is `"S2"`
- **THEN** the exchange throws `DatasourceError { tag: "account-mismatch", retryable: false }` and `CredentialStore.put` is NOT called

### Requirement: OneDrive maps MSAL error classes to the `DatasourceError` taxonomy

`OneDriveClient.normalizeError` SHALL map `@azure/msal-node` error classes surfaced by the auth / refresh path to the engine's `DatasourceErrorTag` taxonomy: `InteractionRequiredAuthError` SHALL map to `auth-expired` (retryable); an MSAL failure whose underlying cause is a network failure SHALL map to `network-error`; every other MSAL auth / refresh error (e.g. `ServerError`, `ClientConfigurationError`) SHALL map to `provider-error`. The existing Microsoft Graph data-path error mapping SHALL be unchanged.

#### Scenario: MSAL InteractionRequiredAuthError maps to auth-expired

- **WHEN** the auth or refresh path throws an MSAL `InteractionRequiredAuthError`
- **THEN** the normalized `DatasourceError` has `tag: "auth-expired"` and `retryable: true`

#### Scenario: MSAL ServerError maps to provider-error

- **WHEN** the auth or refresh path throws an MSAL `ServerError`
- **THEN** the normalized `DatasourceError` has `tag: "provider-error"`
