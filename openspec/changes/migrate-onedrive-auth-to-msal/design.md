## Context

OneDrive authentication today is a hand-rolled OAuth 2.0 authorization-code flow implemented directly in `packages/fs-datasource-engine/src/strategies/onedrive-client.ts`:

- `doAuthenticateImpl()` hand-builds the `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize` URL — **no `code_challenge`, i.e. no PKCE**.
- `completeWith(code)` → `exchangeCodeForTokens()` does a raw `fetch` POST to the token endpoint (`grant_type=authorization_code`; no `code_verifier`, no `client_secret`).
- `refreshTokenImpl()` does a raw `fetch` POST (`grant_type=refresh_token`).
- `captureAccountFromIdToken()` base64url-decodes the `id_token` **without signature verification** (the deliberate "TLS-direct-exchange" trust posture of `enforce-oauth-reconnect-account-match` D2), derives the issuer from the token's own `tid`, and validates `aud/iss/exp/sub` via the shared `oauth/id-token.ts` helper.

The surrounding flow is loopback-based (RFC 8252) and lives in fs-sync's `OAuthLoopbackBroker`: bind `127.0.0.1:0` → compute `redirectUri` → `client.authenticate()` → append CSRF `state` → emit `oauth-open-url` (→ desktop `shell.openExternal`) → on the `/callback` hit validate `state` and call `intent.completeWith(code)`. The engine's `decorateIntent` persists the returned `AuthResult` through the **single-writer** `CredentialStore`. `@microsoft/microsoft-graph-client` is used only for data operations, never auth.

Google Drive (`googledrive-client.ts`) is structurally identical but **already implements PKCE (S256)**. OneDrive is the only OAuth strategy missing it. This change replaces OneDrive's hand-rolled token lifecycle with `@azure/msal-node`'s `PublicClientApplication`, keeping every surrounding component untouched.

MSAL API surface was verified against the canonical `AzureAD/microsoft-authentication-library-for-js` docs during design: the refresh token is never returned in an `AuthenticationResult` (it lives in MSAL's token cache; `acquireTokenSilent` is the supported refresh path), `ICachePlugin` exposes `before/afterCacheAccess` over a `TokenCacheContext` with `serialize()`/`deserialize()`/`cacheHasChanged`, PKCE is minted via `CryptoProvider.generatePkceCodes()`, and `acquireTokenSilent({ account, scopes })` looks the account up via `getTokenCache().getAccountByHomeId()`.

## Goals / Non-Goals

**Goals:**
- Move OneDrive authenticate / exchange / refresh / identity-capture onto `@azure/msal-node` (`PublicClientApplication`).
- Close the PKCE gap (S256) for OneDrive.
- Delegate token caching, silent refresh, authority discovery, and signature-validated identity to MSAL.
- Reduce forced reconnects (silent auto-refresh) while preserving the shipped same-account reconnect guard.
- Keep the fs-sync broker, IPC contract, event taxonomy, renderer, and system-browser mechanic unchanged.

**Non-Goals:**
- Touching the Google Drive strategy. It authenticates against Google's OAuth stack; MSAL is Microsoft-identity-only and does not apply to Drive, so Drive stays hand-rolled.
- Conditional Access / CAE claims-challenge handling.
- WAM / native broker sign-in.
- Cross-app / device-wide SSO or a shared token cache.
- Any change to the loopback-broker, IPC, event, or renderer auth surfaces.

## Decisions

### D1. MSAL runs *inside* the OneDrive strategy; the broker and everything around it are untouched
`doAuthenticateImpl()` builds the authorize URL via MSAL `getAuthCodeUrl(...)`; the returned `OAuthIntent.completeWith(code)` closure calls `acquireTokenByCode(...)`. The broker still owns loopback bind, CSRF `state`, the 5-minute timeout, and invoking `completeWith(code)`. The `OAuthIntent` shape (`{ kind: "oauth", authorizeUrl, completeWith }`) is unchanged, so nothing upstream observes a difference.

**Alternatives considered:** MSAL's `acquireTokenInteractive` / the `msal-node-extensions` interactive helper — rejected because it stands up its **own** loopback listener and system-browser launch, duplicating and conflicting with the existing broker. Using only `getAuthCodeUrl` + `acquireTokenByCode` keeps MSAL as a pure token engine behind the existing flow.

### D2. `PublicClientApplication`, no client secret
A distributed desktop app is a public client; a secret embedded in the binary is not secret. PKCE is the proof-of-possession. `OAuthAppConfig.clientSecret` **stays a required `string`** in the shared `auth-types.ts` — OneDrive's registered config carries `""` and the MSAL public client ignores it. This avoids touching the shared type and rippling into Drive's `URLSearchParams` code (which passes a real secret).

**Alternatives considered:** widening `clientSecret?: string` — rejected: forces a `string | undefined` fix at Drive's one read site for no OneDrive benefit. `ConfidentialClientApplication` — rejected: wrong trust model for a distributed client.

### D3. PKCE via MSAL `CryptoProvider`, threaded through the existing closure
`cryptoProvider.generatePkceCodes()` → `{ verifier, challenge }`. `codeChallenge`/`codeChallengeMethod: "S256"` go on the `getAuthCodeUrl` request; the `verifier` is captured in the `completeWith` closure (never stored on the instance, never persisted, never logged) and passed to `acquireTokenByCode`. Mirrors Drive's per-attempt discipline. The broker's CSRF `state` continues to be appended by the broker to the MSAL-minted URL — MSAL does not need to own `state`, and the broker already validates it on callback.

### D4. Persistence — single writer, **no** `ICachePlugin`
MSAL's token cache is in-memory. Rather than wiring an `ICachePlugin`, the strategy manually `getTokenCache().deserialize(blob)` into the PCA **before** a token op and `getTokenCache().serialize()` **after**, then returns the blob on `AuthResult.meta.msalCache`. The engine's existing "persist the returned `AuthResult`" path performs the **one** write (`decorateIntent` on exchange; `refreshTokenImpl`'s return on refresh). The strategy also mirrors the current access token into the typed top-level `authResult.accessToken` for generic consumers; the blob is the source of truth. `meta.msalCache` rides in the per-strategy **polymorphic `meta`** bag — the exact variation the strategy+template pattern exists to absorb, so there is no shared-schema change.

**Alternatives considered:** an `ICachePlugin` (the idiomatic MSAL way) — rejected because its `afterCacheAccess` write fires *inside* the acquire call and would **clobber** the engine's `AuthResult`-return write (two writers, two shapes, two timings) against a single-writer credential store. Manual serialize/deserialize keeps one writer and one source of truth; the only thing forgone is MSAL's automatic `cacheHasChanged` write-skip (negligible here — we serialize once per auth op regardless).

### D5. Refresh — `acquireTokenSilent`, surfacing reconnect only when unrecoverable
`refreshTokenImpl()` → deserialize blob → `acquireTokenSilent({ account, scopes })` → re-serialize blob → return `AuthResult`. MSAL decides when to actually hit the network and rotates the refresh token internally. When the refresh token is finally dead, MSAL throws `InteractionRequiredAuthError`, which the strategy maps to a retryable `auth-expired` `DatasourceError` — routing into the **existing** auth-expired / reconnect path (the shipped reconnect view). The base class's single-flight still wraps `refreshTokenImpl` (harmless; MSAL also single-flights internally). This is the "one day the long-lived refresh token expires → reconnect for a new token" behavior, now automatic up to that point.

### D6. Identity — read `sub`/`email` from MSAL's validated `idTokenClaims`; keep the `sub` anchor; add `homeAccountId`
`acquireTokenByCode` returns a signature-validated result (a free robustness upgrade over today's decode-only D2 posture). The strategy reads `sub`/`email` from `idTokenClaims` and **preserves** the same-account guard (`enforce-oauth-reconnect-account-match`): on reconnect, compare the freshly-read `sub` to `expectedAccount.sub` and throw `account-mismatch` **before** persist. `meta.account` additionally carries `homeAccountId` (**R1**) so `acquireTokenSilent` can look the account up via `getAccountByHomeId`. `sub` remains the anchor comparison key (Drive symmetry); `homeAccountId` is the MSAL lookup key. OneDrive stops using the hand-rolled `parseIdToken`/`readIdTokenTid` path; the shared `oauth/id-token.ts` helper stays for Drive.

### D7. Scopes — drop MSAL-managed reserved OIDC scopes
MSAL-node manages `openid`/`profile`/`offline_access` itself; passing them explicitly is redundant and can error version-dependently. The strategy passes **resource** scopes `["Files.ReadWrite.All", "User.Read"]` (plus `email` if the claim requires it) and sources identity from `idTokenClaims`. **R2:** `redirectUri` **and** the resource scope set must be byte-identical between `getAuthCodeUrl` and `acquireTokenByCode` — the `completeWith` closure captures the exact dynamic loopback `redirectUri` used to build the URL.

### D8. Authority
`https://login.microsoftonline.com/common` (any organizational directory + personal Microsoft accounts), matching today's `common`. Kept configurable for single-tenant deployments.

### D9. MSAL error → `DatasourceError` mapping
Once MSAL owns exchange/refresh, failures surface as MSAL error classes rather than parsed OAuth-fetch codes. `normalizeError` gains an arm: `InteractionRequiredAuthError` → `auth-expired` (retryable → reconnect); an MSAL failure whose underlying cause is a network failure → `network-error`; every other MSAL auth/refresh error (`ServerError`, `ClientConfigurationError`, non-network `ClientAuthError`) → `provider-error`. Graph data-path error mapping is unchanged. (This matches the spec's "OneDrive maps MSAL error classes" requirement.)

### D10. Dependency — add `@azure/msal-node`
**Justification (per the hard rule):** `@azure/msal-node` is Microsoft's official, supported token-acquisition library. It replaces hand-rolled OAuth crypto and HTTP for OneDrive and provides PKCE, silent auto-refresh with cache management, authority metadata discovery, and JWKS-validated identity — capabilities we would otherwise hand-maintain. The auth-code path needs no native modules (WAM/broker, which would, is a non-goal). Scoped to the `fs-datasource-engine` package that already owns the vendor SDKs (`@aws-sdk/*`, `googleapis`, `@microsoft/microsoft-graph-client`).

### D11. Test seam — duck-typed MSAL client
Production uses the real `@azure/msal-node`; tests inject a duck-typed `PublicClientApplicationLike` covering the ~4 methods used (`getAuthCodeUrl`, `acquireTokenByCode`, `acquireTokenSilent`, and `getTokenCache()` with `serialize`/`deserialize`/`getAccountByHomeId`), mirroring the existing `graphFactory` fake. The fake models a `serialize`/`deserialize` cache round-trip so persistence is covered without a real network or real cache.

## Risks / Trade-offs

- **`meta.msalCache` couples OneDrive's stored shape to MSAL's internal cache schema.** → Mitigation: the blob lives in the per-strategy polymorphic `meta`, so there is no shared-schema impact; MSAL maintains backward compatibility of its serialized cache across minor versions, and the dependency is pinned in `package.json`.
- **Org admin-consent policies can block work/school users** (a Microsoft tenant policy where users cannot self-consent to third-party apps). → Mitigation: none available in-app — this is unchanged from the current hand-rolled flow and identical for any OAuth app; personal OneDrive accounts are unaffected (they always self-consent). Documented as a known limitation.
- **Drive↔OneDrive strategy asymmetry** (Drive hand-rolls PKCE against Google's endpoints; OneDrive uses MSAL against Microsoft's). → Mitigation: accepted; both satisfy the same engine `DatasourceClient` contract and the shared `OAuthIntent` shape, so consumers are agnostic. The asymmetry is **inherent** — MSAL is Microsoft-only, so Drive can never share OneDrive's auth library; any future "symmetry" would mean moving Drive onto Google's own SDK (`google-auth-library`), not MSAL.
- **MSAL is harder to mock than a raw `fetch`.** → Mitigation: the duck-typed client seam (D11) keeps tests hermetic and matches the existing `graphFactory` pattern.

## Migration Plan

- **Data migration: none.** Pre-production; no existing installs carry the old `{accessToken, refreshToken}` OneDrive credential shape. (Had there been installs, the old shape is unreadable by MSAL's cache → users would hit the existing reconnect view once. Not applicable here.)
- **Human prerequisite (blocks real-provider auth, not the code):** register the Azure AD app as a **public client** — supported account types "any organizational directory + personal Microsoft accounts" (`common`), delegated Graph `Files.ReadWrite.All` + `User.Read`, loopback redirect (`http://localhost`) under the Mobile & desktop platform, optional Microsoft Publisher Verification. Wire its `clientId` into the OneDrive `OAuthAppConfig` (config store), with `clientSecret: ""`.
- **Rollback:** revert the change; the hand-rolled path returns. No persisted-data cleanup needed (pre-production).

## Open Questions

- **`email` scope necessity:** whether `email` must be requested explicitly to populate `idTokenClaims.email`, or whether `preferred_username` (available under MSAL-managed `profile`) suffices for the display-only email. Resolve at apply time by inspecting the real claim set; `email` is display-only (the `sub` anchor does not depend on it), so either resolution is non-blocking.
