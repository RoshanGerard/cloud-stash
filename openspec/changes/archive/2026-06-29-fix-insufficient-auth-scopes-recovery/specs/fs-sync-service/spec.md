## ADDED Requirements

### Requirement: `FilesErrorEnvelope` carries an optional `authErrorKind` discriminator threaded from the engine error

The `FilesErrorEnvelope` contract SHALL expose an optional `authErrorKind?: "scope-insufficient"` field — a flat-optional discriminator mirroring the existing `existingPath` / `retryAfterMs` shape (NOT a discriminated union; consumers read it without re-narrowing on `tag`). The value is a string-literal union seeded with the single member `"scope-insufficient"`; future auth sub-classes extend the union additively. The field is absent on every envelope that is not a recognized auth sub-class, so the addition is backward-compatible.

`normalizeFilesError` SHALL populate `authErrorKind: "scope-insufficient"` on the envelope whenever the normalized engine error's `raw` is an object whose `kind === "scope-insufficient"` (defensively shape-checked, mirroring the existing `existingPath` extraction); otherwise the field SHALL be omitted. Because both the Google Drive runtime insufficient-scope 403 and the proactive `status` / `testConnection` scope check throw `auth-revoked` carrying the same `raw.kind`, this single thread surfaces the discriminator for both origins.

`normalizeFilesError` SHALL remain a pure function: it SHALL NOT evict credentials or perform any side effect. Credential recovery is achieved by the reconnect flow overwriting the stored credential on success, NOT by an eviction on the error path — so the `files:list` (and other `files:*`) handler dependencies are unchanged and no credential-store access is threaded onto the read path.

#### Scenario: scope-insufficient engine error threads authErrorKind onto the envelope

- **WHEN** `normalizeFilesError` is given a `DatasourceError` with `tag === "auth-revoked"` and `raw === { kind: "scope-insufficient", requiredScope }`
- **THEN** the returned envelope has `tag === "auth-revoked"`, `message` equal to the engine error's message, and `authErrorKind === "scope-insufficient"`

#### Scenario: non-scope-insufficient errors omit authErrorKind

- **WHEN** `normalizeFilesError` is given a `DatasourceError` whose `raw` lacks `kind === "scope-insufficient"` (e.g. a `provider-error`, a `network-error`, or an `auth-revoked` with no structured `raw`)
- **THEN** the returned envelope omits the `authErrorKind` field entirely

#### Scenario: normalization performs no credential eviction

- **WHEN** `normalizeFilesError` normalizes a scope-insufficient error
- **THEN** it returns the envelope without calling any credential-store delete or any other side effect; the recovery relies on the subsequent reconnect overwriting the credential
