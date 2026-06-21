## ADDED Requirements

### Requirement: Reconnect threads the stored account anchor into the engine authenticate flow

On a reconnect (an `sync:authenticate-start` carrying an existing `datasourceId`), the service SHALL read the datasource's stored account anchor — `StoredCredentials.authResult.meta.account` via the `CredentialStore` — and thread it into the engine auth flow as `expectedAccount` (through `factory.createForAuth(...)` / the loopback broker's `start` path). When the datasource has no stored anchor (first connect, or a pre-upgrade datasource that has not yet captured one), the service SHALL pass no anchor, and the engine performs capture only. The service SHALL NOT compare identities itself — enforcement lives in the engine's pre-persist check.

#### Scenario: Reconnect passes the stored anchor down

- **WHEN** `sync:authenticate-start` is invoked with an existing `datasourceId` whose stored credentials carry `meta.account = { sub, email }`
- **THEN** the service constructs the auth client with `expectedAccount = { sub, email }`

#### Scenario: First connect passes no anchor

- **WHEN** `sync:authenticate-start` is invoked for a datasource with no stored `meta.account`
- **THEN** the service constructs the auth client with no `expectedAccount`, and the engine captures the identity without comparing

### Requirement: Loopback broker maps an engine `account-mismatch` to an `auth-failed` event tagged `account-mismatch`

When `intent.completeWith(code)` rejects with a `DatasourceError` whose tag is `account-mismatch`, the `OAuthLoopbackBroker` SHALL emit `auth-failed` with `tag: "account-mismatch"` (a member of the `AuthFailedTag` wire taxonomy) and a `message` that names the expected account email, rather than the generic `provider-error` mapping. Other `completeWith` rejections continue to map to `provider-error` unchanged.

#### Scenario: Account-mismatch surfaces a typed auth-failed event

- **WHEN** the broker's `completeWith` rejects with `DatasourceError { tag: "account-mismatch" }` carrying expected email `E1`
- **THEN** the broker emits `auth-failed { correlationId, tag: "account-mismatch", message }` where `message` names `E1`
- **AND** no `credential-persisted` / `auth-completed` pair is emitted for that correlation

#### Scenario: Other completion failures are unaffected

- **WHEN** the broker's `completeWith` rejects with a non-account-mismatch error (e.g. a network or provider failure)
- **THEN** the broker emits `auth-failed { tag: "provider-error" }` as before
