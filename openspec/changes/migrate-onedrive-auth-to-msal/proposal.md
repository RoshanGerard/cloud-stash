## Why

OneDrive authentication is currently a hand-rolled OAuth 2.0 authorization-code flow (raw `fetch` against `login.microsoftonline.com` in `onedrive-client.ts`) that **omits PKCE** and hand-decodes the `id_token` without signature validation. This diverges both from Microsoft's officially supported client library (MSAL) and from the Google Drive strategy, which already uses PKCE. Adopting `@azure/msal-node` aligns OneDrive onto the vendor-supported SDK, closes the PKCE gap, and delegates token caching, silent refresh, authority discovery, and signed-token validation to MSAL — reducing forced reconnects for users.

## What Changes

- Replace OneDrive's hand-rolled authorize-URL construction, token exchange, and refresh with `@azure/msal-node` `PublicClientApplication` (`getAuthCodeUrl` + `acquireTokenByCode` + `acquireTokenSilent`), driven inside the existing OneDrive strategy.
- Add **PKCE (S256)** to the OneDrive authorize/exchange via MSAL's `CryptoProvider`, matching Drive.
- MSAL owns the token cache; its serialized cache blob is persisted in the OneDrive credential's polymorphic `meta.msalCache`. Refresh becomes silent (`acquireTokenSilent`); a forced reconnect surfaces **only** when the refresh token is unrecoverable (`InteractionRequiredAuthError` → `auth-expired`).
- Source the same-account reconnect anchor (`sub`) from MSAL's signature-validated `idTokenClaims`; additionally persist `homeAccountId` in `meta.account` for silent-refresh account lookup. The same-account hard-block on reconnect is **preserved**.
- Map MSAL error classes to the engine's `DatasourceError` taxonomy.
- Add `@azure/msal-node` as an engine dependency (justified in `design.md`).
- The fs-sync `OAuthLoopbackBroker`, IPC contract, event taxonomy, renderer flow, and system-browser mechanic are **UNCHANGED**.
- Google Drive is **unchanged** — it stays hand-rolled (deliberate two-strategy asymmetry).

## Capabilities

### New Capabilities

<!-- None. OneDrive authentication already exists as fs-datasource-engine behavior; this change modifies it. -->

### Modified Capabilities

- `fs-datasource-engine`: OneDrive's OAuth authenticate / token-exchange / refresh / identity-capture requirements move to an `@azure/msal-node` public-client implementation — adding PKCE (S256), an MSAL-owned token cache persisted at `meta.msalCache`, silent refresh via `acquireTokenSilent`, MSAL-error → `DatasourceError` mapping, and `homeAccountId` in the account anchor. Google Drive's OAuth requirements are untouched.

## Impact

- **Code:** `packages/fs-datasource-engine/src/strategies/onedrive-client.ts` (auth path rewrite — `doAuthenticateImpl`, exchange, `refreshTokenImpl`, `normalizeError`, credential extraction); `packages/fs-datasource-engine/package.json` (+`@azure/msal-node`). OneDrive stops using `packages/fs-datasource-engine/src/oauth/id-token.ts` (retained for Drive). `services/fs-sync/src/oauth/loopback-broker.ts` is verified-unchanged.
- **Dependencies:** adds `@azure/msal-node` (public client; no native modules required for the auth-code path).
- **Persisted data:** OneDrive `StoredCredentials.authResult.meta` gains `msalCache`; `meta.account` gains `homeAccountId`. Pre-production — no existing installs to migrate.
- **Operational prerequisite (HUMAN op, mirrors Drive's GCP step):** an Azure AD app registration as a **public client** — supported account types "any organizational directory + personal Microsoft accounts" (`common`), delegated Graph `Files.ReadWrite.All` + `User.Read`, loopback redirect (`http://localhost`) registered under the Mobile & desktop platform, optional Microsoft Publisher Verification. **End users configure nothing** — they sign in + consent in the system browser exactly as today.
- **Known limitation (unchanged from today):** org admin-consent policies can gate work/school users; personal OneDrive accounts are unaffected.
