# Proposal: Lint-enforce the error-tag const-reference convention + close the guard blind-spots

**Status**: Proposed (promoted from stub). Spawned by
`migrate-error-tag-literals-to-const-refs` design.md Decision 5 + Decision 6
on 2026-06-20.

## Why

`migrate-error-tag-literals-to-const-refs` migrated every raw
`DatasourceErrorTag` / `FilesErrorTag` literal in tag-context to the const
reference and shipped a Vitest grep-scan guard
(`packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts`)
that keeps the tree green. Two pieces of enforcement were deliberately
deferred to this follow-up:

1. **ESLint editor-integration rule** (Decision 5). The Vitest guard is a
   CI/test-time backstop; it does not give editor-time feedback. A custom
   ESLint rule flags a raw literal as the developer types it and offers a
   quick-fix to the const reference — closing the loop the guard can only
   catch after the fact.

2. **Guard pattern blind-spots** (Decision 6). The Vitest guard matches
   `tag` / `errorTag` / `.tag` construction + comparison + `case` arms. It
   does NOT match the sibling string-typed fields that ALSO carry an engine
   tag value verbatim:
   - `lastErrorTag` (the job-persistence / `JobSummary` field) — carries
     engine tags like `"unsupported"` / `"network-error"` (written in
     production at `services/fs-sync/src/scheduler/scheduler.ts:157`) plus
     non-enum service sentinels (`"service-restart"`).
   - `engineCause` (the `download-retrying` event diagnostic field) —
     documented to carry a `DatasourceErrorTag` verbatim
     (`packages/ipc-contracts/src/sync-service/events.ts:264`).

## What Changes

- Add a custom AST-based ESLint rule `ft5/no-raw-error-tag-literal`
  (`tools/eslint-rules/no-raw-error-tag-literal.mjs`, wired as an inline
  plugin in `eslint.config.mjs`) that flags raw `DatasourceErrorTag` /
  `FilesErrorTag` value literals in error-tag context and offers **opt-in
  ESLint suggestions** (never an autofix applied by `--fix`).
- Widen enforcement to the two Decision-6 blind-spot fields `lastErrorTag`
  and `engineCause` (both carry `DatasourceErrorTag` values): widen the
  Vitest guard's matched field set AND cover them in the new rule.
- Migrate the literals brought newly in-scope by the widening: 1 production
  site (`scheduler.ts:157` `lastErrorTag: "unsupported"` →
  `DatasourceErrorTag.Unsupported`) + ~17 test fixtures (`"network-error"` /
  `"rate-limited"`). Non-tag values on those fields (`"range-not-honored"`,
  `"service-restart"`, the `"err"` placeholder) stay raw — they are not tag
  values, so neither layer flags them.
- Keep BOTH enforcement layers and reconcile their exceptions (the Vitest
  guard stays the non-bypassable CI backstop + spec-scenario anchor; the
  ESLint rule adds editor DX). Share only the vocabulary; handle the
  genuine value-position off-vocabulary exceptions per-layer.
- No behavior change: tag values, wire payloads, and derived unions are
  byte-identical.

## Capabilities

- `fs-datasource-engine` — MODIFIED. The `DatasourceErrorTag`
  const-reference convention now also covers the `lastErrorTag` /
  `engineCause` sibling fields and is enforced by a second mechanism (the
  ESLint rule) in addition to the grep-scan guard.
- `fs-sync-service` — MODIFIED. The `FilesErrorTag` const-reference
  convention is now also enforced by the ESLint rule.

## Out of scope

- Re-migrating the in-scope `tag` / `errorTag` sites (already done).
- Changing the underlying tag values or the const-object member sets.
- Introducing const objects for the OTHER tag vocabularies surfaced during
  the migration — `ServiceErrorTag` and `AuthFailedTag` are plain type
  unions today; converting either to an `as const` object (so its literals
  could also be migrated) is its own separate change. Their value-position
  literals stay raw.
- Enabling type-aware ESLint rules. The flat config defers
  `projectService` (no workspace tsconfig yet, `eslint.config.mjs:9-12`),
  so the rule is purely syntactic.

## Decisions

Resolved during brainstorming; full rationale in `design.md`:

- **D1 — Scope = all four fields** (`tag`, `errorTag`, `lastErrorTag`,
  `engineCause`).
- **D2 — AST syntactic rule**, not type-aware (type services unavailable).
- **D3 — Opt-in ESLint suggestions, never `--fix`** (a wrong-enum autofix
  on a shared value injects silently, type-safe and test-green).
- **D4 — Keep both layers; share vocabulary only; exceptions per-layer.**

## Acceptance criteria

- A custom ESLint rule `ft5/no-raw-error-tag-literal` forbids raw error-tag
  literals in tag-context across `tag` / `errorTag` / `lastErrorTag` /
  `engineCause`, is wired into `eslint.config.mjs`, and `pnpm lint`
  enforces it. RuleTester covers valid + invalid cases and the suggestion
  output.
- The Vitest guard's matched field set is widened to the same four fields;
  the newly-flagged literals are migrated to const refs.
- The two enforcement layers agree: they share the same tag vocabulary +
  field→enum map; genuine value-position off-vocabulary sites
  (`ServiceErrorTag` / `AuthFailedTag` literals, off-taxonomy fixtures)
  carry an `eslint-disable` comment for the rule and remain in the guard's
  `WIRE_LITERAL_ALLOWLIST`.
- No behavior change; full test suite, typecheck, lint, and
  `openspec validate --strict` pass.

## Provenance

- Spawned by `migrate-error-tag-literals-to-const-refs` (the migration that
  established the convention + the grep-scan guard). Decision 5 deferred the
  ESLint rule; Decision 6 documented the `lastErrorTag` / `engineCause`
  guard-pattern boundary. Both land here.
