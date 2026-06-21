## Why

When an OAuth/OIDC datasource (Google Drive, OneDrive) expires and the user clicks **Reconnect**, the flow reuses the existing `datasourceId` and overwrites its stored credentials with **whatever account the user picks at the consent screen** — there is no `login_hint` to steer the choice and no identity check after the token exchange. No account identity is persisted today (`StoredCredentials.meta` holds only OAuth app config), so there is nothing to compare against. The result is a silent data-source swap: during `acme@gmail.com`'s reconnect a user can sign in as `other@gmail.com` and the datasource now points at the wrong Drive — same id, same display name, different account's files.

## What Changes

- Add **account-identity capture** to the OAuth authenticate flow: after the token exchange, read the OIDC `sub` + `email` from the issued `id_token` and persist `{ sub, email }` on the datasource's stored credentials. Requires widening the authorize-URL scope to include `openid email`.
- Add **same-account enforcement on reconnect**: fs-sync reads the datasource's stored account anchor and threads it into the auth flow; the engine strategy compares the freshly-authenticated `sub` against the anchor and **hard-blocks a mismatch before any credential is persisted** — the original datasource is left untouched. First-time connects (no anchor yet) simply capture.
- **BREAKING (error vocabulary):** introduce a new `account-mismatch` error tag in the engine `DatasourceErrorTag` taxonomy (and a matching `auth-failed` wire tag), carrying the **expected account email** so the UI can tell the user which account to use.
- Surface the block as an **amber "Wrong account" callout** in both reconnect surfaces (file-explorer reconnect view + dashboard card), reading the already-plumbed `sessionState.tag`/`message`, keeping Reconnect live for a retry.
- Add `login_hint` (the stored email) to the reconnect authorize URL so the provider pre-selects the right account — a UX aid, not the enforcement.
- **Fail closed**: if the identity read itself fails, reject the reconnect (retryable) rather than allow an unverified swap.
- Scope: **both** OAuth providers (`google-drive`, `onedrive`). Enforcement is **per-datasource** — not a global one-account-per-datasource rule.

## Capabilities

### New Capabilities
<!-- None — all affected capabilities already exist under openspec/specs/. -->

### Modified Capabilities

- `fs-datasource-engine`: OAuth `authenticate` captures `{ sub, email }` into `AuthResult.meta.account`; credential refresh preserves it; a reconnect carrying an injected expected-account anchor throws the new `account-mismatch` tag on `sub` mismatch **before** persistence; identity-read failure fails closed; authorize URL requests `openid email` and includes `login_hint` on reconnect. Adds `account-mismatch` to the error taxonomy.
- `fs-sync-service`: the reconnect path reads the stored account anchor and threads it into the engine auth flow; the OAuth loopback broker maps an engine `account-mismatch` failure to an `auth-failed` event tagged `account-mismatch` carrying the expected email.
- `datasources-ui`: the dashboard card's auth-error banner renders the condensed "Wrong account" mini-callout from the failed session's tag + message, keeping Reconnect live.
- `file-explorer`: the reconnect view renders the full "Wrong account" callout (expected + actual account) from the failed session's tag + message, keeping Reconnect live.

## Impact

- **Engine** (`packages/fs-datasource-engine`): `googledrive-client.ts` + `onedrive-client.ts` authorize-URL scope/`login_hint`, token-exchange identity capture, `refreshTokenImpl` anchor preservation, post-exchange compare; `factory.ts` `createForAuth` gains an optional `expectedAccount` slot threaded to strategy constructors; `DatasourceErrorTag` gains `account-mismatch`.
- **Contracts** (`packages/ipc-contracts`): `DatasourceErrorTag` taxonomy + the `AuthFailedTag` wire union widen by one member; `AuthResult.meta.account` shape documented.
- **Service** (`services/fs-sync`): `authenticate-start` / loopback broker thread the anchor and map the new failure tag.
- **Renderer** (`apps/desktop`): `invalid-datasource.tsx` + `card.tsx` render the new callout from `sessionState`.
- **Tooling**: `tools/error-tag-vocabulary.mjs`, the `ft5/no-raw-error-tag-literal` lint vocab, and the error-tag drift guard learn `account-mismatch`.
- **Migration**: datasources connected before this ships have no stored anchor; they capture it on their next successful auth and are enforced from then on (the first post-upgrade re-auth). No data migration required.
- **No new runtime dependencies** (`id_token` is a plain JWT; payload decode + `aud`/`iss` validation use existing primitives).
