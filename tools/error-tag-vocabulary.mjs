/**
 * Single source of truth for the error-tag vocabulary shared by:
 *   - the Vitest grep-scan guard (packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts)
 *   - the ESLint rule (tools/eslint-rules/no-raw-error-tag-literal.mjs, Task 3)
 *
 * This is a plain ESM data module with NO imports so it can be loaded
 * directly by ESLint via Node without needing to resolve the TypeScript
 * package graph. The drift guard in:
 *   packages/ipc-contracts/src/__tests__/error-tag-vocabulary.drift.test.ts
 * keeps this file in sync with the actual `DatasourceErrorTag` and
 * `FilesErrorTag` const objects — if a new tag value is added to either enum,
 * that test fails until this module is updated.
 */

// The union of every DatasourceErrorTag + FilesErrorTag value (14 distinct).
export const TAG_VALUES = [
  "auth-expired", "auth-revoked", "not-found", "conflict", "unsupported",
  "rate-limited", "network-error", "provider-error", "cancelled",
  "invalid-datasource", "account-mismatch", "disconnected", "other",
  "exhausted-retries",
];

// The error-tag field names the convention enforces (object-property keys and
// comparison/case discriminants). NOT a `*Tag` wildcard.
export const ENFORCED_FIELDS = ["tag", "errorTag", "lastErrorTag", "engineCause"];

// For lastErrorTag/engineCause the enum is deterministically DatasourceErrorTag
// (engine-layer fields). For tag/errorTag it is context-dependent (either enum),
// represented as null.
export const FIELD_ENUM = {
  tag: null,
  errorTag: null,
  lastErrorTag: "DatasourceErrorTag",
  engineCause: "DatasourceErrorTag",
};

// value -> the enum(s) that contain it and the MEMBER NAME to reference.
// 9 unique values map to ONE enum; the 5 shared values map to BOTH (same
// member name in each). This drives the ESLint suggestion builder later.
export const VALUE_ENUM_MEMBERS = {
  "auth-expired":       { DatasourceErrorTag: "AuthExpired" },
  "auth-revoked":       { DatasourceErrorTag: "AuthRevoked", FilesErrorTag: "AuthRevoked" },
  "not-found":          { DatasourceErrorTag: "NotFound" },
  "conflict":           { DatasourceErrorTag: "Conflict", FilesErrorTag: "Conflict" },
  "unsupported":        { DatasourceErrorTag: "Unsupported" },
  "rate-limited":       { DatasourceErrorTag: "RateLimited", FilesErrorTag: "RateLimited" },
  "network-error":      { DatasourceErrorTag: "NetworkError" },
  "provider-error":     { DatasourceErrorTag: "ProviderError" },
  "cancelled":          { DatasourceErrorTag: "Cancelled", FilesErrorTag: "Cancelled" },
  "invalid-datasource": { DatasourceErrorTag: "InvalidDatasource", FilesErrorTag: "InvalidDatasource" },
  "account-mismatch":   { DatasourceErrorTag: "AccountMismatch" },
  "disconnected":       { FilesErrorTag: "Disconnected" },
  "other":              { FilesErrorTag: "Other" },
  "exhausted-retries":  { FilesErrorTag: "ExhaustedRetries" },
};
