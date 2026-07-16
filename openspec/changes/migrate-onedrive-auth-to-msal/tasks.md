## 1. Prerequisite — Azure app registration (HUMAN op)

- [ ] 1.1 (HUMAN) Register the CloudStash app in Azure AD as a **public client**: supported account types "any organizational directory + personal Microsoft accounts" (`common`); delegated Microsoft Graph permissions `Files.ReadWrite.All` + `User.Read`; loopback redirect `http://localhost` registered under the **Mobile & desktop** platform. Optionally complete Microsoft Publisher Verification to suppress the unverified-app banner.
- [ ] 1.2 (HUMAN) Wire the registered `clientId` into the OneDrive `OAuthAppConfig` in the service config store, with `clientSecret: ""`. Confirm **no end-user account configuration** is required (users sign in + consent in the system browser as today).

## 2. Dependency + MSAL client seam

- [ ] 2.1 Add `@azure/msal-node` to `packages/fs-datasource-engine/package.json` dependencies; install; confirm the engine builds (`pnpm --filter @cloudstash/fs-datasource-engine build`).
- [ ] 2.2 Define a duck-typed `PublicClientApplicationLike` interface (`getAuthCodeUrl`, `acquireTokenByCode`, `acquireTokenSilent`, `getTokenCache()` → `{ serialize, deserialize, getAccountByHomeId }`) plus a `MsalClientFactory`, mirroring the existing `GraphFactory` pattern. Provide `createDefaultMsalFactory` that builds the real `PublicClientApplication` (authority `https://login.microsoftonline.com/common`, `clientId` from config); allow injection for tests.
- [ ] 2.3 Add a test fake MSAL client modelling a `serialize`/`deserialize` cache round-trip with deterministic canned results (auth-code + silent), including a fixed `homeAccountId` / `sub` / `email` and `idTokenClaims`.

## 3. Authorize URL + PKCE (`doAuthenticateImpl`)

- [ ] 3.1 (test, watch it fail) Authorize URL carries `code_challenge` with `code_challenge_method=S256`, `redirect_uri` equals the loopback `redirectUri`, and scopes are `["Files.ReadWrite.All","User.Read"]` (no `openid`/`profile`/`offline_access`).
- [ ] 3.2 (test) `completeWith("fake-auth-code")` calls `acquireTokenByCode` exactly once with the matching `codeVerifier`, the same `redirectUri`, and the same scopes used to build the URL.
- [ ] 3.3 Implement `doAuthenticateImpl` via `getAuthCodeUrl` + `CryptoProvider.generatePkceCodes()`; capture the `verifier` in the `completeWith` closure (never stored on the instance / persisted / logged); exchange via `acquireTokenByCode`. Keep the `OAuthIntent` shape unchanged so the broker is untouched.

## 4. Cache persistence — `meta.msalCache`, single writer

- [ ] 4.1 (test) A fresh exchange persists `meta.msalCache === serialize()` blob, mirrors the access token to top-level `authResult.accessToken`, and calls `CredentialStore.put` exactly once.
- [ ] 4.2 (test) Constructing from `StoredCredentials` carrying `meta.msalCache` deserializes the blob into the PCA before any `acquireTokenSilent`.
- [ ] 4.3 Implement `deserialize`-before / `serialize`-after around MSAL ops; return `meta.msalCache` on the `AuthResult`; mirror the top-level `accessToken`. Do NOT register an `ICachePlugin` (single-writer invariant — the engine's `AuthResult` persist path is the sole writer).

## 5. Identity capture + `homeAccountId` + same-account guard

- [ ] 5.1 (test) A first-connect exchange persists `meta.account = { sub, email, homeAccountId }` read from the MSAL result's `idTokenClaims` + account; `email` defaults to `""` when the claim is absent.
- [ ] 5.2 (test) A reconnect with `expectedAccount.sub === "S1"` and an exchanged `idTokenClaims.sub === "S2"` throws `DatasourceError { tag: "account-mismatch", retryable: false }` before any `CredentialStore.put`.
- [ ] 5.3 Implement identity capture from `acquireTokenByCode`'s validated `idTokenClaims` + `account.homeAccountId`; preserve the `expectedAccount` `sub` hard-block before persist. Remove OneDrive's use of `parseIdToken` / `readIdTokenTid` (retain the shared `oauth/id-token.ts` helper for Drive).

## 6. Silent refresh

- [ ] 6.1 (test) `acquireTokenSilent` success → refreshed `authResult.accessToken`, re-serialized `meta.msalCache`, preserved `meta.account`, and no authorize URL produced.
- [ ] 6.2 (test) `acquireTokenSilent` rejecting `InteractionRequiredAuthError` → `refreshCredentials()` rejects `DatasourceError { tag: "auth-expired", retryable: true }` and no `CredentialStore.put` with a new value.
- [ ] 6.3 Implement `refreshTokenImpl` via `acquireTokenSilent({ account, scopes })`, resolving the account via `getAccountByHomeId(meta.account.homeAccountId)`; base-class single-flight unchanged.

## 7. MSAL error mapping

- [ ] 7.1 (test) `InteractionRequiredAuthError` → `auth-expired` (retryable); `ServerError` → `provider-error`; a network-cause MSAL failure → `network-error`.
- [ ] 7.2 Implement the `normalizeError` MSAL arm; leave the Microsoft Graph data-path error mapping untouched.

## 8. Cleanup, verification, validation

- [ ] 8.1 Remove the now-dead hand-rolled OneDrive auth code (raw-`fetch` `exchangeCodeForTokens`, raw-`fetch` refresh, `captureAccountFromIdToken` hand-decode, `readIdTokenTid`); confirm no remaining references in `onedrive-client.ts`.
- [ ] 8.2 Confirm `services/fs-sync/src/oauth/loopback-broker.ts` and the IPC / event / renderer auth surfaces are unchanged and their existing tests still pass.
- [ ] 8.3 Full `@cloudstash/fs-datasource-engine` + `fs-sync` test suites, typecheck, and lint green (including the `cloudstash/no-raw-error-tag-literal` rule).
- [ ] 8.4 `openspec validate migrate-onedrive-auth-to-msal --strict` is green.
- [ ] 8.5 Defer the real-provider packaged OAuth smoke (blocked on the §1 Azure registration) to PENDING_TC and record it in the change's completion notes.
