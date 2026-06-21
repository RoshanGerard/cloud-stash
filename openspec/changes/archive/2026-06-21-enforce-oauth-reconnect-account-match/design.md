## Context

OAuth/OIDC datasources reconnect through `sync:authenticate-start`, which reuses the existing `datasourceId` ([authenticate-start.ts:114](../../../services/fs-sync/src/commands/authenticate-start.ts)). The loopback broker runs `factory.createForAuth(...)` + `client.authenticate()`, and on the `/callback` hit calls `intent.completeWith(code)` ([loopback-broker.ts](../../../services/fs-sync/src/oauth/loopback-broker.ts)). The engine base's `completeAuth` runs the strategy's token exchange and **then** persists via `CredentialStore.put` ([base-client.ts:806-821](../../../packages/fs-datasource-engine/src/base-client.ts)).

Three facts make the account-swap possible and shape the fix:

1. The Google authorize URL requests only the Drive scope, sets `prompt: "consent"`, and includes **no `login_hint`** ([googledrive-client.ts:1004-1040](../../../packages/fs-datasource-engine/src/strategies/googledrive-client.ts)); OneDrive is equivalent. The consent screen therefore offers any account.
2. There is **no post-exchange identity check**, and `AuthResult.meta` carries only OAuth app config (`clientId`/`clientSecret`/`redirectUri`/`scope`) — no account identity is persisted, so there is no anchor to compare against.
3. `factory.createForAuth` is contractually **"the credential store is NOT consulted"** ([factory.ts:218-252](../../../packages/fs-datasource-engine/src/factory.ts)), and `AuthSessionState` already carries `{ status: "failed"; tag; message? }` to the renderer ([store.tsx:415-420](../../../apps/desktop/src/renderer/src/features/datasources/store.tsx)) — both surfaces currently throw the tag/message away and render a generic line.

This was resolved through brainstorming (architectural + visual) plus advisor checkpoint #1. The user chose **hard block** on mismatch and **both** OAuth providers.

## Goals / Non-Goals

**Goals:**
- A reconnect that authenticates as a different account than the one the datasource is bound to is **hard-blocked before any credential is overwritten**; the original datasource stays intact.
- Account identity is captured on connect and **survives credential refresh**.
- The block is **actionable**: the user is told which account to use, in both reconnect surfaces.
- Covers `google-drive` and `onedrive` under one mechanism.

**Non-Goals:**
- No "re-point this datasource to a new account" path (the user chose hard block; deliberate rebind stays "remove + re-add"). 
- No global uniqueness rule — the same account may back two distinct datasources. Binding is per-`datasourceId`.
- No retroactive backfill for already-connected datasources beyond capture-on-next-auth (see Migration).
- S3 (credentials-form) is untouched — it has no OAuth identity to bind.

## Decisions

### D1 — Anchor on the OIDC `sub`, not email
`sub` is stable and unique per user; **email is mutable** (OIDC explicitly says don't key on it), so email is **display-only** and `sub` is the comparison key. Add `openid email` to both providers' authorize-URL scope. `isScopeSufficient` checks *inclusion* of the Drive scope ([googledrive-client.ts:406-408](../../../packages/fs-datasource-engine/src/strategies/googledrive-client.ts)), so a superset issued-scope does **not** regress it; existing Drive-only tokens keep working.
- *Alternatives:* email as key — rejected (mutable/reassignable). Google `about.user.permissionId` — rejected: avoids the scope change but its cross-session stability/uniqueness guarantees are unverified, and it would need two provider-specific identity calls instead of one symmetric `id_token` parse.

### D2 — Identity from the `id_token`
With `openid` present, the token endpoint returns an `id_token` (JWT). Decode its payload and extract `sub` + `email`, validating `aud === clientId`, `iss` is the provider's issuer, and `exp` is in the future. The `id_token` comes **directly from the provider's token endpoint over TLS** in response to our own authenticated code exchange (not via the browser), so payload decode + claim validation is sufficient — no signature-verification dependency. Microsoft `sub` is pairwise per `client_id` but **stable across reconnects for our app**, which is exactly the "same account on reconnect" property we need.
- *Alternative:* call the provider `userinfo`/`/me` endpoint — rejected: an extra round-trip and a second provider-specific code path for no added trust.

### D3 — Capture in the engine, into `AuthResult.meta.account`
The strategy writes `meta.account = { sub, email }` during token exchange; the base persists it into `StoredCredentials.authResult.meta.account` via the existing `completeAuth` path. **Load-bearing:** `refreshTokenImpl` MUST carry `meta.account` forward — Google's `refresh_token` grant returns no `id_token`, so a naive refresh that rebuilds `meta` from app-config only would silently erase the anchor and disable enforcement on the next reconnect. Both strategies' refresh paths read the current stored `meta.account` and re-emit it.

### D4 — Enforce via injected anchor + throw-before-persist (Option A)
`createForAuth` gains an optional `expectedAccount?: { sub; email }` threaded to the strategy constructor alongside `preAuth`. fs-sync's reconnect path reads `credentialStore.get(datasourceId)?.authResult.meta.account` and passes it down. After the exchange yields the new `sub`, the strategy: if `expectedAccount` is set **and** `newSub !== expectedAccount.sub`, throws `DatasourceError(account-mismatch)` **inside the exchange closure**. Because `completeAuth` runs the closure *before* `persistCredentials`, the throw skips persistence with **no rollback window** — the original credentials are never touched. First connect (no `expectedAccount`) captures only.
- *Alternatives:* **Option B** — fs-sync compares *after* the engine persists, then rolls back on mismatch. Rejected: a window exists where the wrong account's credentials are written. **Option C** — the strategy reads its own prior creds (`credentialStore.get(datasourceId)`) to self-compare. Rejected: violates the `createForAuth` "store not consulted" contract and couples capture with policy in the engine.

This split keeps the provider-specific identity fetch where the SDK lives (engine) while the *policy* — whether this is an enforced reconnect (anchor present) or a first capture — is owned by fs-sync, consistent with the `migrate-*-to-consumer` direction.

### D5 — New `account-mismatch` error tag, payload carries the expected email
The engine throws a dedicated `account-mismatch` `DatasourceErrorTag`. The loopback broker's `completeWith` catch inspects `err instanceof DatasourceError && err.tag === DatasourceErrorTag.AccountMismatch` and emits `auth-failed { tag: "account-mismatch", message, expectedEmail, actualEmail? }` — `account-mismatch` is a new member of the `AuthFailedTag` wire union, and the event payload gains a structured **`expectedEmail`** (always present for this tag) plus optional **`actualEmail`** (the account just signed-in-as). The engine error carries both emails (and both `sub`s) on its `raw`; the broker lifts `expectedEmail`/`actualEmail` onto the event; the desktop bridge and the renderer `AuthSessionState` thread them through to the components. **Structured fields are required (not a single pre-built `message`)** because the two surfaces render *different* copy — the reconnect view names expected + actual, the card names only expected (see Visual direction) — so copy assembly must live in the renderer. `message` remains a generic fallback string. `tools/error-tag-vocabulary.mjs`, the `ft5/no-raw-error-tag-literal` lint vocab, and the drift guard learn the new engine tag (the `AuthFailedTag` wire union is a type-union vocabulary intentionally outside the const-ref convention, so it gets no vocab entry).
- *Alternative:* reuse `auth-revoked`/`invalid-datasource` with a `raw.kind` discriminator — rejected: a distinct, recoverable, user-correctable condition deserves a first-class, inspectable tag that maps to its own UI treatment (the user chose a hard block with specific copy).

### D6 — `login_hint` on reconnect (UX, not enforcement)
When an `expectedAccount` is present, append `login_hint=<stored email>` to the authorize URL so the provider pre-selects the right account and most users never hit the block. This is steering, not a guarantee — the user can still switch — which is exactly why D4's hard check is the actual enforcement.

### D7 — Fail closed on identity-read failure
If the `id_token` is absent/unparseable or claim validation fails, the strategy throws a **retryable** error rather than persisting unverified credentials — never allow a swap to slip through because identity couldn't be read.

### D8 — Per-datasource binding + capture-on-next-auth migration
The anchor lives on the datasource's own stored credentials; there is no cross-datasource uniqueness constraint. Datasources connected before this ships have no `meta.account` → their next successful auth captures it (first-connect path), and enforcement applies from then on — i.e. starting at the first post-upgrade re-auth, which is exactly the moment the swap bug occurs.

## Visual direction

Locked via the Visual Companion this session. One shared **amber "Wrong account" callout** language across both surfaces; **red stays reserved for hard errors, amber signals a recoverable correction**. Both surfaces branch on `sessionState.tag === "account-mismatch"` and assemble their own copy from the structured `sessionState.expectedEmail` (plus `actualEmail?` on the reconnect view) carried on the failed session (per D5), instead of the hardcoded generic "Reconnect failed" line, and keep **Reconnect live** for a retry. (`sessionState.message` stays as a generic fallback.)

**File-explorer reconnect view** ([invalid-datasource.tsx](../../../apps/desktop/src/renderer/src/features/file-explorer/states/invalid-datasource.tsx)) — full callout **below** the Reconnect/Remove buttons, naming **both** accounts:
- Title: **Wrong account**
- Body: *"This datasource is connected to **{expected}**. You signed in as **{actual}**. Reconnect using {expected} to continue."*

**Dashboard card** ([card.tsx](../../../apps/desktop/src/renderer/src/features/datasources/card.tsx) `AuthErrorBanner`) — condensed mini-callout, Reconnect inside, card grows taller:
- Title: **Wrong account**
- Body: *"Connect as **{expected}** to continue."*

**Tokens (WCAG AA verified):**
- Light: title `#92400e`, body `#78350f`, background `#fffbeb`, border `#fcd34d`.
- Dark: title `#fcd34d`, body `#fde68a`, background `rgba(217,119,6,.13)`, border `#a16207`.
- Icon: Lucide `alert-triangle`, amber (`#d97706` light / `#fbbf24` dark).

**Accessibility:** retain `role="alert"` + `aria-live="polite"` on the container; the callout is real text (not icon-only); Reconnect remains keyboard-reachable. The `{actual}` account is shown only when the failed-session payload provides it (the reconnect view); the card shows only `{expected}`.

## Risks / Trade-offs

- **Refresh erases the anchor** → enforcement silently disabled. *Mitigation:* D3 makes anchor-preservation an explicit `refreshTokenImpl` requirement with a dedicated test (refresh in → `meta.account` out unchanged).
- **Scope widening surprises existing users** — the next reconnect's consent screen mentions email/profile. *Mitigation:* `prompt: "consent"` already forces a consent screen on every auth, so there's no *new* prompt, only one extra line; `isScopeSufficient` confirmed to accept supersets so no operational regression.
- **`id_token` shape drift between providers** (Google `sub` vs Microsoft pairwise `sub`). *Mitigation:* D2 only relies on `sub` being stable per our `client_id` across reconnects, which holds for both; tests use provider-representative `id_token` fixtures.
- **Error-taxonomy widening is cross-cutting** (engine tag + wire tag + vocab + lint + guard). *Mitigation:* the error-tag tooling is purpose-built to absorb new tags (see `add-error-tag-literal-lint`); a focused task covers every touch-point with the existing drift guard as the backstop.
- **Legacy datasource briefly unprotected** until its first post-upgrade re-auth. *Mitigation:* accepted and documented (D8) — unavoidable without an account the system has never seen, and the first re-auth is exactly when capture happens.

## Migration Plan

No data migration. On upgrade, existing `StoredCredentials` simply lack `meta.account`; the first successful (re-)auth captures the anchor via the first-connect path, and enforcement engages from the following reconnect. Rollback is clean: reverting the change leaves `meta.account` as inert extra data on stored credentials (ignored by the prior code).

## Open Questions

None — architectural and visual decisions are resolved. Provider-`id_token` claim specifics (Google `iss = https://accounts.google.com`; Microsoft issuer/`tid`) are confirmed at implementation time against representative fixtures during TDD.
