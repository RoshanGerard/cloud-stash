## MODIFIED Requirements

### Requirement: `DatasourceErrorTag` values are referenced via the const object, not raw string literals

Every TypeScript source and test file SHALL reference `DatasourceErrorTag`
values through the `DatasourceErrorTag` const object exported from
`@ft5/ipc-contracts` (e.g. `DatasourceErrorTag.AuthRevoked`) — across the
workspace (`packages/`, `services/`, `apps/`, `scripts/`) — rather than
the equivalent raw string literal (e.g. `"auth-revoked"`) in any
error-tag context: construction (`tag: ...`), comparison (`tag === ...` /
`tag !== ...`), or `switch`/`case` arm. The enforced field set SHALL
include the sibling fields `lastErrorTag` and `engineCause`, which carry a
`DatasourceErrorTag` value verbatim (the job-persistence / `JobSummary`
field and the `download-retrying` diagnostic field respectively); a tag
value assigned to either field as a raw literal MUST migrate to the const
reference. This is a behavior-preserving convention: the const's value IS
the same string, so wire payloads and the derived `DatasourceErrorTag`
union are unchanged.

This convention SHALL be enforced by TWO complementary mechanisms that
agree on the same tag vocabulary and field set:

- The const-convention **guard test**
  (`packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts`)
  — a non-bypassable CI/test-time backstop that grep-scans the workspace.
- A custom **ESLint rule** `ft5/no-raw-error-tag-literal`
  (`tools/eslint-rules/no-raw-error-tag-literal.mjs`, wired as an inline
  plugin in `eslint.config.mjs`) — an AST rule providing editor-time
  feedback and opt-in suggestions. It is syntactic (no type services); it
  SHALL NOT apply an autofix via `--fix` (a wrong-enum substitution on a
  shared value is type-safe and test-green, so it MUST NOT be auto-applied),
  but MAY offer opt-in ESLint suggestions to the const reference.

The following are explicitly EXEMPT and MAY remain raw strings:

- The const-object definition itself in
  `packages/ipc-contracts/src/fs-datasource-engine.ts`.
- Serialized protocol payloads — JSON inside MSW handlers, recorded
  provider-response fixtures, or any string asserted as the on-the-wire
  value rather than a typed `DatasourceErrorTag` value.
- `openspec/specs/**/*.md` (documents wire values; off-limits to direct
  edits) and code comments.
- `dist/` build outputs and `node_modules/`.
- Type-position declarations — `readonly tag:` interface members and
  string-literal union types — which DECLARE a contract's allowed tag
  values (definitions, peers of the const object), not value references.
  The ESLint rule, visiting value positions only, never flags these without
  a dedicated exemption.
- Non-tag values that legitimately appear on `lastErrorTag` / `engineCause`
  (the service sentinel `"service-restart"`, the diagnostic cause
  `"range-not-honored"`, test placeholders) — these are not
  `DatasourceErrorTag` members, so neither mechanism flags them.
- Literals belonging to a DIFFERENT error vocabulary that happens to
  share the string. `ServiceErrorTag` (the `SyncCommandError` / sync
  `ErrorShape` family) is a plain type union with no const object and is
  out of scope; its only value shared with `DatasourceErrorTag` is
  `not-found`. A `not-found` literal on a `SyncCommandError` / `sync:*`
  site stays raw — recorded in the guard allowlist and carrying an
  `// eslint-disable-next-line ft5/no-raw-error-tag-literal -- <reason>`
  for the rule — while `not-found` on a `DatasourceError` site MUST migrate.

Because the five values shared with `FilesErrorTag` (`auth-revoked`,
`rate-limited`, `conflict`, `cancelled`, `invalid-datasource`) are
type-identical across both enums, each `tag` / `errorTag` site SHALL use
the const whose enum matches the declared type of the value at that site;
the compiler does not distinguish them, so enum-correctness is
review-enforced. The `lastErrorTag` / `engineCause` fields are
engine-layer and map deterministically to `DatasourceErrorTag`.

#### Scenario: No raw `DatasourceErrorTag` literals remain outside exemptions

- **WHEN** the const-convention guard test (`packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts`) grep-scans every `.ts` / `.tsx` file under `packages/`, `services/`, `apps/`, and `scripts/` for raw error-tag string literals in an error-tag context (`tag` / `errorTag` / `lastErrorTag` / `engineCause` / `.tag` construction or comparison, and `case` arms)
- **THEN** it finds zero occurrences of any `DatasourceErrorTag` value as a raw literal, excluding the const definition, serialized-payload fixtures, comments, `dist/`, and `node_modules/`

#### Scenario: Engine error taxonomy values are unchanged

- **WHEN** the migration replaces a literal such as `tag === "auth-revoked"` on a `DatasourceError` with `tag === DatasourceErrorTag.AuthRevoked`
- **THEN** the runtime value, the emitted/thrown `DatasourceError` shape, and the `DatasourceErrorTag` derived union are byte-identical, and the existing engine test suite passes unchanged

#### Scenario: `lastErrorTag` / `engineCause` tag literals are enforced

- **WHEN** a tag value (e.g. `"unsupported"` at `services/fs-sync/src/scheduler/scheduler.ts`, or `"network-error"` in a fixture) is assigned to `lastErrorTag` or `engineCause` as a raw string literal
- **THEN** both the guard test and the ESLint rule flag it, and the migrated site references `DatasourceErrorTag.Unsupported` / `DatasourceErrorTag.NetworkError`; a non-tag value on either field (`"service-restart"`, `"range-not-honored"`, `"err"`) is NOT flagged and remains a raw literal

#### Scenario: ESLint rule flags a raw literal and offers an opt-in suggestion

- **WHEN** a developer writes `tag: "auth-revoked"` (or any tag value in an enforced field) in editor and ESLint evaluates `ft5/no-raw-error-tag-literal`
- **THEN** the rule reports the violation and offers opt-in suggestion(s) to the const reference (one suggestion for an unambiguous value; two — `DatasourceErrorTag.*` and `FilesErrorTag.*` — for one of the five shared values on `tag` / `errorTag`), inserting the `@ft5/ipc-contracts` import if absent; the rule never applies a fix via `eslint --fix`

#### Scenario: ESLint rule does not flag type-position declarations or off-discriminant `case` arms

- **WHEN** the rule visits a `readonly tag: "not-found"` interface member, a string-literal union type, or a `case "other":` arm whose `switch` discriminant is not a `.tag` / `.errorTag` member (e.g. a `DatasourceMimeFamily` switch)
- **THEN** the rule does not report — it visits value positions only, and scopes `case` enforcement to switches discriminating on a tag member
