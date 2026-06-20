## Context

`migrate-error-tag-literals-to-const-refs` (archived 2026-06-20) migrated
every raw `DatasourceErrorTag` / `FilesErrorTag` literal in tag-context to
the const reference and shipped a Vitest grep-scan guard
(`packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts`).
That migration's Decision 5 deferred an editor-time ESLint rule, and its
Decision 6 documented a guard-pattern boundary: the guard matches `tag` /
`errorTag` / `.tag` construction + comparison + `case` arms, but NOT the
sibling fields `lastErrorTag` and `engineCause`, which also carry engine
tag values verbatim. This change lands both.

Current state, grounded by grep:

- **ESLint setup**: flat config (`eslint.config.mjs`, ESM), ESLint 10.2.1,
  `typescript-eslint` 8.58.2, `eslint-plugin-import-x`. No custom-rule
  infrastructure exists yet. The config **explicitly defers type-aware
  rules** (`eslint.config.mjs:9-12`): "Section 2 has no workspace tsconfig
  yet, so enabling the TypeScript project service would fail on every file
  it lints."
- **`lastErrorTag`** value-position literals (all assigners): `"network-error"`,
  `"unsupported"` (both `DatasourceErrorTag`-**unique**), plus the non-tag
  sentinels `"service-restart"` and the `"err"` test placeholder. One is a
  PRODUCTION write (`scheduler.ts:157` `lastErrorTag: "unsupported"`); the
  rest are test fixtures. No `FilesErrorTag`-unique value and no shared
  value ever lands here.
- **`engineCause`** value-position literals: `"network-error"` (Datasource-
  unique), `"rate-limited"` (shared, but fixed to `DatasourceErrorTag` by
  the `events.ts:264` contract), and `"range-not-honored"` (NOT a tag
  value). The only production assignment (`files-download.ts:1202`) is
  `"range-not-honored"`; the flaggable `engineCause` literals are all in
  test fixtures.

## Goals / Non-Goals

**Goals:**

- A custom ESLint rule that flags raw error-tag value literals in error-tag
  context at edit time, with opt-in editor suggestions to the const ref.
- Close the Decision-6 blind-spots: bring `lastErrorTag` and `engineCause`
  under enforcement in BOTH the ESLint rule and the widened Vitest guard.
- Keep the two enforcement layers consistent (same vocabulary, same field
  set) without fragile cross-toolchain coupling.
- Zero behavior change.

**Non-Goals:**

- Type-aware linting / enabling `projectService` (deferred by the config;
  a much larger change).
- Migrating `ServiceErrorTag` / `AuthFailedTag` (no const objects; separate
  changes). Their value-position literals stay raw.
- An autofix applied by `--fix` (explicitly excluded — see Decision 3).
- Re-migrating the already-done `tag` / `errorTag` sites.

## Decisions

### Decision 1 — Scope = all four fields (`tag`, `errorTag`, `lastErrorTag`, `engineCause`)

The rule and the widened guard enforce const references on an **explicit
named-field list**, not a `*Tag` wildcard (a wildcard would false-positive
on `JobKind`-style identifiers). The four fields, with their resolved
field→enum mapping:

| Field | Enum context | Ambiguity |
|---|---|---|
| `tag` | `DatasourceErrorTag` OR `FilesErrorTag` (per surrounding type) | 5 shared values ambiguous; 8 unique values deterministic |
| `errorTag` | same as `tag` | same |
| `lastErrorTag` | `DatasourceErrorTag` (job/engine layer) | none observed — only Datasource-unique values land here |
| `engineCause` | `DatasourceErrorTag` (by `events.ts:264` contract) | none — contract fixes the enum even for the shared `rate-limited` |

**Why all four** (the user's choice over the recommended three): maximal
drift-protection and a uniform rule. The cost is the `engineCause`
half-const appearance (see Risks). `lastErrorTag` / `engineCause` map
deterministically to `DatasourceErrorTag`, verified against every assigner
(no `FilesErrorTag`-unique value ever lands on either), so widening adds no
new ambiguity — only `tag` / `errorTag` shared values remain ambiguous, and
those are already handled by the existing convention.

**Alternative considered:** three fields (drop `engineCause`). Rejected by
the user; `engineCause` enforcement is mostly test-fixture churn but keeps
the displayed cause aligned with the taxonomy it documents.

### Decision 2 — AST syntactic rule, not type-aware

The rule is a pure-syntactic AST rule (no `@typescript-eslint` type
services), because the flat config defers `projectService`. An AST rule is
also strictly **more precise** than the regex guard, which lets most of the
guard's current allowlist entries vanish for the rule (see Decision 4):

- It visits **value positions only** — object-expression `Property` values,
  `BinaryExpression` operands (`===` / `!==` / `==`), and `SwitchCase`
  tests. Type-position declarations (`readonly tag: "not-found"`,
  string-literal union members) are TS type nodes the rule never visits →
  never flagged, no exemption needed.
- For `case` arms it scopes to switches whose **discriminant is a
  `.tag` / `.errorTag` member expression**, eliminating the
  `case "other"`-over-`DatasourceMimeFamily` false-positive the regex guard
  had to allowlist.

The rule flags a string literal whose value is one of the 13 tag values
when it appears in one of those positions under one of the four field
names. Non-tag values (`"range-not-honored"`, `"service-restart"`, `"err"`)
are not in the vocabulary → never flagged.

**Alternative considered:** type-aware rule that reads the declared type to
disambiguate shared values automatically. Rejected — requires enabling
`projectService` (config-wide change, explicitly deferred) and a workspace
tsconfig that does not exist.

### Decision 3 — Opt-in ESLint suggestions, never an autofix applied by `--fix`

The rule provides ESLint **suggestions** (editor-only, opt-in quick-fixes
the developer selects), NOT a `fix` (which `eslint --fix` / `lint:fix`
applies automatically):

- Unambiguous values (the 8 unique `tag`/`errorTag` values; everything on
  `lastErrorTag`/`engineCause`) → ONE suggestion (`Replace with
  DatasourceErrorTag.X` / `FilesErrorTag.X`).
- The 5 shared values on `tag` / `errorTag` → TWO suggestions
  (`DatasourceErrorTag.X` and `FilesErrorTag.X`); the developer picks.
- Each suggestion also inserts the named import from `@ft5/ipc-contracts`
  if absent.

**Why never `--fix`:** `lint:fix` runs in CI / pre-commit. An autofix
picking the wrong enum on a shared value would be injected silently,
type-safe AND test-green (the migration's Decision 2 hazard: the compiler
cannot distinguish `DatasourceErrorTag.AuthRevoked` from
`FilesErrorTag.AuthRevoked`, and the runtime value is identical). Editor
suggestions are never auto-applied, so the hazard cannot reach a commit.

**Alternative considered:** flag-only (no suggestions). Simpler, but drops
the "offer a fix" affordance the proposal called for; the editor DX is the
main thing this layer adds over the guard that already exists.

### Decision 4 — Keep both enforcement layers; share vocabulary only; exceptions per-layer

The Vitest guard stays:

- It is **non-bypassable** — there is no per-line `eslint-disable` escape
  hatch for it, so it backstops a rule that can be locally disabled.
- It is the **spec-scenario anchor** (the migration's Decision 3
  requirements are backed by "the const-convention guard test grep-scans…").
- It is **toolchain-independent** — it runs in the test suite without the
  ESLint toolchain.

Reconciliation (acceptance criterion "the two layers agree"):

- **Share the vocabulary, not the exception list.** Both layers derive from
  the same 13 tag values + the field→enum map. The AST rule's precision
  means most current guard allowlist entries (type-position lines,
  `case "other"`) simply do not arise in the rule. Cross-toolchain
  path+trimmed-line key matching between a `.ts` line-scanner and a `.mjs`
  AST rule is fragile and WOULD drift — so it is avoided.
- **Handle exceptions per-layer in each idiom.** The handful of genuine
  **value-position** off-vocabulary sites (`ServiceErrorTag`
  `tag: "not-found"`, `AuthFailedTag` `tag: "auth-revoked"`, the
  off-taxonomy `store.test.ts` fixtures, the back-compat `test-d` literal)
  get a `// eslint-disable-next-line ft5/no-raw-error-tag-literal -- <reason>`
  for the rule, and remain in the guard's `WIRE_LITERAL_ALLOWLIST`. Both
  lists are auditable; neither reimplements the other.
- **Widen the guard's field set** to the same four fields so the two layers
  enforce identical scope.

**Alternative considered:** retire the Vitest guard, ESLint as sole
enforcement. Rejected — loses the non-bypassable backstop and orphans the
Decision-3 spec scenarios.

### Decision 5 — Rule lives at `tools/eslint-rules/`, wired as a flat-config inline plugin

`tools/eslint-rules/no-raw-error-tag-literal.mjs` exports the rule object;
`eslint.config.mjs` imports it and registers `plugins: { ft5: { rules: {
"no-raw-error-tag-literal": rule } } }` with `rules: {
"ft5/no-raw-error-tag-literal": "error" }` in a repo-wide config block. The
rule is unit-tested with ESLint's `RuleTester`. The test lives at
`scripts/eslint-rules/no-raw-error-tag-literal.test.ts` (NOT colocated under
`tools/`): the repo's vitest `include` scans `scripts/**`, `packages/**`,
`apps/**`, `services/**` — not `tools/**`, and `scripts/` is where the repo's
other tooling-guardrail tests live (e.g. `provider-sdk-forbidden-import.test.ts`),
mirroring how Task 1's drift guard landed in a vitest-included path while its
module stays under `tools/`. The RuleTester suite is added to the grep guard's
`EXEMPT_FILES` because its `code:` fixtures embed raw literals as test input
(the same rationale the guard test itself is exempt).

**Why:** minimal footprint — no new published workspace package, no build
step. Matches the config's stated "minimal change" ethos.

**Alternative considered:** a dedicated `packages/eslint-plugin-ft5`
workspace package. Rejected — overkill for one rule; adds package.json +
build wiring.

The shared vocabulary module (`tools/error-tag-vocabulary.mjs`, plain data:
the 13 values + the field→enum map) is consumed by the rule. The Vitest
guard already hardcodes the same values; to prevent drift it imports the
same module (or a guard-local `expect` asserts equality with
`Object.values(DatasourceErrorTag) ∪ Object.values(FilesErrorTag)`).

## Risks / Trade-offs

- **`engineCause` half-const (accepted tradeoff, per the user's all-four
  choice).** After migration, `engineCause: DatasourceErrorTag.NetworkError`
  sits next to a literal `engineCause = "range-not-honored"` (a non-tag
  cause). This is a deliberate consequence of enforcing a free-form
  diagnostic field, recorded here so a future reader reads it as a decision,
  not an oversight. Behavior is unaffected — `engineCause` is documented
  diagnostic-only and "the renderer SHALL NOT branch on its value."

- **Rule could be locally disabled** (`// eslint-disable-next-line`). →
  Mitigated by the non-bypassable Vitest guard (Decision 4); a disable that
  hides a real in-scope literal is still caught at test time.

- **Vocabulary drift between the two layers.** → Single shared vocabulary
  module + a guard assertion that the value set equals the union of the two
  const objects.

- **Suggestion import-insertion edge cases** (existing partial import,
  type-only import, alias). → RuleTester covers the common shapes; a
  suggestion that produces invalid code is a test failure, and because
  suggestions are opt-in, a missed edge case degrades to "developer fixes by
  hand," never a silent bad autofix.

- **`lastErrorTag` / `engineCause` future shared value.** The field→enum map
  hardcodes `DatasourceErrorTag` for both. If a `FilesErrorTag`-unique or
  shared value were ever assigned there, the suggestion would point at the
  wrong enum. → Today no such value lands there (verified); both fields are
  engine-layer by design. Documented so a future assigner re-checks.

- **Intentional scope boundary — the contract is field-scoped, not
  value-scoped.** Both layers enforce tag values only in the three
  *field-attached* contexts: construction (`tag:`/`errorTag:`/…),
  comparison (`.tag === …`), and `case` arms over a tag discriminant. A tag
  value reached by other means — a *type-annotated binding*
  (`const x: FilesErrorTag = "auth-revoked"`), a `return "auth-revoked"`, or
  a bare function argument — is NOT flagged by either layer (no preceding
  field-name token / no Property-or-comparison-or-case node). This is a
  deliberate boundary (matching the original migration's tag-context scope),
  not an oversight: widening to bare values would collide with non-tag uses
  of the same strings (`ConflictPolicy`, `JobStatus`, the word "other").
  Such literals stay raw; if one must carry a tag value, prefer the const
  ref by hand.

- **File-coverage asymmetry between the two layers (known limitation).** The
  ESLint rule runs repo-wide (every `.ts`/`.tsx`/`.mjs`/`.cjs` ESLint lints,
  including `tools/` and repo-root config), whereas the non-bypassable grep
  guard scans only `packages/`, `services/`, `apps/`, `scripts/` (`.tsx?`
  only). So a *future* enforced-field tag literal added under `tools/` or at
  repo root would be caught by the (locally-disable-able) ESLint layer but
  NOT by the non-bypassable grep backstop. No current hole (those files
  carry no field-context tag literals). Accepted as a known limitation;
  closing it (add `tools` to the guard's `SCAN_ROOTS`) is a cheap optional
  follow-up.

## Migration Plan

TDD order (per advisor checkpoint #1):

1. Widen the Vitest guard's matched field set to `tag` / `errorTag` /
   `lastErrorTag` / `engineCause` (extract the vocabulary to the shared
   module first). Watch it go RED on the newly-flagged literals.
2. Migrate those literals to const refs — `scheduler.ts:157` (production) +
   the ~17 test fixtures — driving the guard GREEN. Non-tag values stay raw.
3. Add the ESLint rule with `RuleTester` (RED → GREEN): valid cases, invalid
   cases per field, suggestion output (one vs two), import insertion,
   `case`-discriminant scoping, type-position non-flagging.
4. Wire the inline plugin into `eslint.config.mjs`; add `eslint-disable`
   comments to the genuine value-position off-vocabulary sites.
5. Full `pnpm lint` + full test suite + typecheck + `openspec validate
   --strict` + per-capability spec validation.

**Rollback:** purely mechanical and behavior-preserving — revert the
commits; no data, schema, or wire migration to unwind.

## Open Questions

None blocking. The stub's Q1–Q4 are resolved by Decisions 1 (scope),
1 + Risks (sentinel handling — non-tag values are never flagged, so no
sentinel const/allowlist is needed), 3 (suggestions, no `--fix`), and 4
(keep both, reconcile via shared vocabulary).
