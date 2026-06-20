## Context

The error-tag const-convention guard (`error-tag-const-convention.test.ts`) is the
non-bypassable half of a two-layer enforcement (guard test + `ft5/no-raw-error-tag-literal`
ESLint rule) introduced by `migrate-error-tag-literals-to-const-refs` and
`add-error-tag-literal-lint`. Its `SCAN_ROOTS` is currently
`["packages", "services", "apps", "scripts"]`. `tools/` — which holds the ESLint rule
(`tools/eslint-rules/no-raw-error-tag-literal.mjs`) and the shared vocabulary
(`tools/error-tag-vocabulary.mjs`) — is not scanned. The adversarial review of
`add-error-tag-literal-lint` flagged this as a file-coverage asymmetry (finding #6),
deferred as an optional follow-up. This change closes it.

## Goals / Non-Goals

**Goals:**
- Widen the guard's `SCAN_ROOTS` to include `tools/`, matching the requirement's own
  "Every TypeScript source and test file … across the workspace" wording.
- Keep impl and spec in sync: update both canonical const-convention requirements to
  enumerate `tools/` as a fifth scanned root.

**Non-Goals:**
- No change to the ESLint rule, the vocabulary module, or the guard's matching logic
  (patterns, exemptions, allowlist).
- No migration of any literal (none exists under `tools/` to migrate — the dir holds
  only `.mjs`, which the guard does not scan).

## Decisions

- **D1 — Add `"tools"` to `SCAN_ROOTS`.** One array entry. The guard's `collectFiles`
  walk already filters to `.tsx?` and honors `SKIP_DIRS`, so `tools/` is traversed the
  same way as the other roots.
- **D2 — Modify the existing scenario, do not add a new one.** Both specs' "No raw …
  literals remain outside exemptions" scenario already asserts the guard grep-scans the
  enumerated roots and finds zero violations. Adding `tools/` to that scenario's WHEN
  clause (and to the requirement prose's root parenthetical) captures the contract change
  without inventing a scenario for a directory that currently has nothing to find.
- **D3 — No new `EXEMPT_FILES`.** `tools/` contains only `.mjs` files; the guard scans
  `.ts`/`.tsx` only, so neither the vocab module nor the ESLint rule is scanned. If a
  future `.ts`/`.tsx` under `tools/` legitimately needs a raw literal (e.g. a RuleTester
  suite), it gets an exemption at that time — exactly as
  `scripts/eslint-rules/no-raw-error-tag-literal.test.ts` is exempt today.

## Risks / Trade-offs

- **Inert at this commit.** Because `tools/` has no `.ts`/`.tsx` today, the guard result
  is unchanged (still green, zero violations). The value is forward coverage + removing
  the spec/impl divergence — not a behavior change now. Accepted: the cost is one array
  entry and a mechanical spec edit; the benefit is that the convention's own enforcement
  directory can never silently harbor a raw error-tag literal in future TS.
- **Spec churn for an inert change.** The const-convention requirement lives in two
  capabilities (`fs-datasource-engine`, `fs-sync-service`), so both deltas must move
  together to keep the enumerated roots consistent. Mitigated by bundling both into this
  one change.
