## ADDED Requirements

### Requirement: Reconnect threads the stored account anchor into the engine authenticate flow

On a reconnect (an `sync:authenticate-start` carrying an existing `datasourceId`), the service SHALL read the datasource's stored account anchor — `StoredCredentials.authResult.meta.account` via the `CredentialStore` — and thread it into the engine auth flow as `expectedAccount` (through `factory.createForAuth(...)` / the loopback broker's `start` path). An anchor is usable whenever `meta.account.sub` is a non-empty string — `sub` is the sole comparison key (per design D1); `email` is display-only and SHALL NOT gate whether the anchor is threaded (an absent / empty `email` is normalized to `""`). When the datasource has no usable anchor (first connect, a pre-upgrade datasource that has not yet captured one, or an account object with no non-empty `sub`), the service SHALL pass no anchor, and the engine performs capture only. The service SHALL NOT compare identities itself — enforcement lives in the engine's pre-persist check.

#### Scenario: Reconnect passes the stored anchor down

- **WHEN** `sync:authenticate-start` is invoked with an existing `datasourceId` whose stored credentials carry `meta.account = { sub, email }`
- **THEN** the `OAuthLoopbackBroker` reads the stored anchor via `credentialStore.get(datasourceId)` and constructs the auth client by passing `expectedAccount = { sub, email }` as the trailing argument to `factory.createForAuth(...)`

#### Scenario: First connect passes no anchor

- **WHEN** `sync:authenticate-start` is invoked for a datasource with no stored `meta.account` (a first connect, or a pre-upgrade datasource that has not yet captured one)
- **THEN** the broker passes no `expectedAccount` to `factory.createForAuth(...)`, and the engine captures the identity without comparing

#### Scenario: An anchor with no non-empty `sub` is treated as absent

- **WHEN** `sync:authenticate-start` is invoked with an existing `datasourceId` whose stored `meta.account` carries no non-empty `sub`
- **THEN** the broker passes no `expectedAccount` (capture-only), rather than enforcing against an anchor with no comparison key

#### Scenario: An anchor with a `sub` but no `email` still enforces (`sub` is the sole key)

- **WHEN** `sync:authenticate-start` is invoked with an existing `datasourceId` whose stored `meta.account` has a non-empty `sub` but an absent or empty `email` (e.g. a Microsoft / AAD id_token that omits the `email` claim)
- **THEN** the broker threads `expectedAccount = { sub, email: "" }` to `factory.createForAuth(...)` so the engine still enforces the same-account check on `sub` — gating on `email` would silently disable the hard block for email-less accounts

### Requirement: Loopback broker maps an engine `account-mismatch` to an `auth-failed` event tagged `account-mismatch`

When `intent.completeWith(code)` rejects with a `DatasourceError` whose tag is `account-mismatch`, the `OAuthLoopbackBroker` SHALL emit `auth-failed` with `tag: "account-mismatch"` (a member of the `AuthFailedTag` wire taxonomy), rather than the generic `provider-error` mapping. The broker SHALL lift the structured emails off the engine error's `raw` onto the event: `expectedEmail` (the bound account's email, present whenever the engine supplied it) and the optional `actualEmail` (the email of the account just signed-in-as, best-effort). `message` remains a generic fallback string. Other `completeWith` rejections — including the fail-closed `auth-expired` identity-read failure — continue to map to `provider-error` unchanged.

#### Scenario: Account-mismatch surfaces a typed auth-failed event with structured emails

- **WHEN** the broker's `completeWith` rejects with `DatasourceError { tag: "account-mismatch" }` whose `raw` carries `expectedEmail = E1` and `actualEmail = E2`
- **THEN** the broker emits `auth-failed { correlationId, tag: "account-mismatch", message, expectedEmail: E1, actualEmail: E2 }`
- **AND** no `credential-persisted` / `auth-completed` pair is emitted for that correlation

#### Scenario: Account-mismatch with no readable actual email still surfaces the expected email

- **WHEN** the broker's `completeWith` rejects with `DatasourceError { tag: "account-mismatch" }` whose `raw` carries `expectedEmail = E1` but no `actualEmail`
- **THEN** the broker emits `auth-failed { correlationId, tag: "account-mismatch", message, expectedEmail: E1 }` with `actualEmail` omitted

#### Scenario: Other completion failures are unaffected

- **WHEN** the broker's `completeWith` rejects with a non-account-mismatch error (e.g. a network or provider failure, or the fail-closed `auth-expired` identity-read failure)
- **THEN** the broker emits `auth-failed { tag: "provider-error" }` as before, with no `expectedEmail` / `actualEmail`
