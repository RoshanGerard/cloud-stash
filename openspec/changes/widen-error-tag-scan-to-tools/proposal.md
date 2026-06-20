## Why

The const-convention guard test (`error-tag-const-convention.test.ts`) grep-scans
`packages/`, `services/`, `apps/`, and `scripts/` — but **not** `tools/`, even though
the requirement it enforces says "Every TypeScript source and test file SHALL reference
… across the workspace." `tools/` is where the convention's own enforcement machinery
lives (the `ft5/no-raw-error-tag-literal` ESLint rule and the shared
`error-tag-vocabulary.mjs`). The omission is a coverage gap: a future `.ts`/`.tsx` file
added under `tools/` carrying a raw error-tag literal would be silently missed by the
non-bypassable guard. Closing it now aligns the enumerated scan roots with the
requirement's stated "across the workspace" intent and future-proofs the guard.

## What Changes

- Add `"tools"` to `SCAN_ROOTS` in
  `packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts`, so the
  guard's grep-scan covers `tools/` alongside the existing four roots.
- **MODIFY** the `DatasourceErrorTag`/`FilesErrorTag` const-convention requirements in
  both canonical specs to enumerate `tools/` as a fifth scanned root (the prose
  parenthetical and the scenario WHEN clause in each).
- No production code changes. No new error code, wire field, default, or scenario.
  The change is **inert at this commit** — `tools/` currently holds only `.mjs` files
  and the guard scans only `.ts`/`.tsx` — so the guard result is unchanged today; the
  value is forward coverage + spec/impl alignment.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `fs-datasource-engine`: the "`DatasourceErrorTag` values are referenced via the const
  object" requirement's scanned-root set widens from four roots to five (adds `tools/`).
- `fs-sync-service`: the "`FilesErrorTag` values are referenced via the const object"
  requirement's scanned-root set widens from four roots to five (adds `tools/`).

## Impact

- Test infrastructure: one-line `SCAN_ROOTS` widening (test-only).
- Canonical specs: `openspec/specs/fs-datasource-engine/spec.md` +
  `openspec/specs/fs-sync-service/spec.md` (synced via OpenSpec lifecycle, not edited
  directly).
- No runtime, wire, API, or dependency impact. The guard remains non-bypassable and
  the ESLint rule is unchanged.
