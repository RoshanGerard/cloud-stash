# Tasks: add-error-tag-literal-lint

TDD order per `design.md` Migration Plan. Worktree + subagent-per-task +
two-stage review per CLAUDE.md Coding discipline.

## 1. Shared vocabulary module

- [x] 1.1 Create `tools/error-tag-vocabulary.mjs` exporting plain data: the
      13 tag values (`TAG_VALUES`), the enforced field-name set
      (`["tag", "errorTag", "lastErrorTag", "engineCause"]`), and the
      field→enum map (`lastErrorTag`/`engineCause` → `DatasourceErrorTag`;
      `tag`/`errorTag` → context-dependent) + the value→enum(s) map
      (8 unique values → their single enum; 5 shared values → both).
- [x] 1.2 Add a drift guard: a test (or an assertion inside the existing
      guard) that `TAG_VALUES` equals `Object.values(DatasourceErrorTag) ∪
      Object.values(FilesErrorTag)`, so the shared module cannot drift from
      the const objects.

## 2. Widen the Vitest guard + migrate newly-flagged literals (TDD: RED → GREEN)

- [x] 2.1 Refactor `packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts`
      to source `TAG_VALUES` + the field-name set from
      `tools/error-tag-vocabulary.mjs`; widen the matched field set to
      include `lastErrorTag` and `engineCause`. Confirm the guard goes RED
      on the newly-flagged tag-valued literals.
- [x] 2.2 Migrate the production site
      `services/fs-sync/src/scheduler/scheduler.ts:157`
      `lastErrorTag: "unsupported"` → `DatasourceErrorTag.Unsupported`
      (add/extend the `@ft5/ipc-contracts` import).
- [x] 2.3 Migrate the newly-flagged test-fixture literals on `lastErrorTag`
      / `engineCause` carrying tag values (`"network-error"`,
      `"rate-limited"`) → `DatasourceErrorTag.*` across
      `services/fs-sync/**` + `apps/desktop/**` test files (per the grep
      list in design.md Context).
- [x] 2.4 Confirm non-tag values stay raw and unflagged
      (`"range-not-honored"`, `"service-restart"`, the `"err"`
      placeholder). Guard GREEN.

## 3. ESLint rule (TDD with RuleTester: RED → GREEN)

- [x] 3.1 Write `scripts/eslint-rules/no-raw-error-tag-literal.test.ts`
      using ESLint `RuleTester` FIRST (RED). Cover: valid (const ref, non-tag
      literal, type-position decl, `case` over non-tag discriminant);
      invalid per enforced field (`tag`/`errorTag`/`lastErrorTag`/`engineCause`)
      for construction, comparison (both operand orders), and `case` arm.
      (Test lives under `scripts/` — vitest does not scan `tools/**`; see
      design.md Decision 5.)
- [x] 3.2 Add suggestion-output assertions: unambiguous value → ONE
      suggestion; the 5 shared values on `tag`/`errorTag` → TWO suggestions
      (`DatasourceErrorTag.*` + `FilesErrorTag.*`); `lastErrorTag`/`engineCause`
      shared value (`rate-limited`) → ONE `DatasourceErrorTag.*` suggestion.
      Assert each suggestion inserts the `@ft5/ipc-contracts` named import
      when absent (and does NOT duplicate an existing import).
- [x] 3.3 Guarantee NO `--fix` autofix: the rule reports via
      `context.report({ ..., suggest })` with NO top-level `fix` and `meta`
      has no `fixable`, so `eslint --fix` is structurally a no-op (the
      load-bearing guarantee). RuleTester invalid cases declare no top-level
      `output` (which would fail if a `fix` existed) and exercise the
      suggestion fixers only.
- [x] 3.4 Implement `tools/eslint-rules/no-raw-error-tag-literal.mjs`:
      AST visitors for `Property` values, `BinaryExpression` operands, and
      `SwitchCase` tests; field-name match via the shared vocabulary;
      `case`-arm enforcement scoped to a `.tag`/`.errorTag` discriminant;
      value→enum suggestion builder + import-insertion fixer; unwraps
      `as const`/`satisfies` for grep-guard parity. Drive RuleTester GREEN.

## 4. Wire the rule + reconcile exceptions

- [x] 4.1 Register the inline plugin in `eslint.config.mjs`
      (`plugins: { ft5: { rules: {...} } }`, `"ft5/no-raw-error-tag-literal":
      "error"` in a repo-wide block). Import the rule module.
- [x] 4.2 Run `pnpm lint`; for each genuine value-position off-vocabulary
      site the rule flags (`ServiceErrorTag` `tag:"not-found"`, `AuthFailedTag`
      `tag:"auth-revoked"`/`"provider-error"`, off-taxonomy `store.test.ts`
      fixtures, the back-compat `datasource-error-tag.test-d.ts` literal),
      add `// eslint-disable-next-line ft5/no-raw-error-tag-literal -- <reason>`
      matching the corresponding guard `WIRE_LITERAL_ALLOWLIST` reason.
      (21 sites disabled across 15 files.)
- [x] 4.3 Confirm the two layers agree on the value-position off-vocabulary
      sites (Decision 4 — share the vocabulary, NOT the exception list, so the
      invariant is `rule-disables ⊆ guard allowlist`, not bidirectional): every
      site the ESLint rule flags as a genuine off-vocabulary exception carries
      BOTH an `// eslint-disable-next-line ft5/no-raw-error-tag-literal` comment
      AND a matching guard `WIRE_LITERAL_ALLOWLIST` entry. Guard-only allowlist
      entries that the AST rule structurally never flags — type-position
      declarations and `case` arms over a non-`.tag`/`.errorTag` discriminant
      (e.g. `files-entry-mapping.ts` `case "other"` over `DatasourceMimeFamily`)
      — have NO rule counterpart, by design. Both layers enforce the same four
      fields. `pnpm lint` clean.

## 5. Verification

- [x] 5.1 Full `pnpm lint` clean (rule active repo-wide; exit 0, zero ft5 violations).
- [x] 5.2 Full test suite green (306 files / 2816 passed / 10 skipped; Vitest
      guard + drift + RuleTester + unchanged behavior across migrated fixtures).
- [x] 5.3 Typecheck (`tsc -b`) clean.
- [x] 5.4 `openspec validate add-error-tag-literal-lint --strict` green;
      per-capability `openspec validate fs-datasource-engine --type spec`
      and `fs-sync-service --type spec` green after sync.
- [x] 5.5 Reactive/forward audit confirmation: no runtime behavior change;
      spec deltas cover the widened field set + the second enforcement
      mechanism (the "previously-implicit invariant becoming load-bearing"
      trigger is already addressed by the MODIFIED requirements).

## 6. Deferred manual smoke (PENDING_TC.MD)

- [x] 6.1 Editor-integration smoke (RECORDED in PENDING_TC.MD; HUMAN smoke
      deferred — RuleTester's 41 cases prove the rule + suggestion logic):
      in VS Code with the ESLint extension,
      type `tag: "auth-revoked"` and confirm the squiggle + the two opt-in
      Quick Fix suggestions (`DatasourceErrorTag.AuthRevoked` /
      `FilesErrorTag.AuthRevoked`) appear and apply correctly with import
      insertion. RuleTester proves the rule logic; only a live editor
      confirms the IDE surfacing. Record in `PENDING_TC.MD`.
