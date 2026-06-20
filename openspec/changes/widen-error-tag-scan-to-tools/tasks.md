## 1. Implementation

- [ ] 1.1 Add `"tools"` to `SCAN_ROOTS` in `packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts` (the only impl edit).

## 2. Verification

- [ ] 2.1 Run the guard test — confirm it stays green (zero violations; `tools/` adds no `.ts`/`.tsx` to scan today).
- [ ] 2.2 Run the full `@ft5/ipc-contracts` test suite — confirm the drift test and the rest stay green.
- [ ] 2.3 `openspec validate widen-error-tag-scan-to-tools --strict` — green.

## 3. Spec sync + archive

- [ ] 3.1 `/opsx:sync` (or `openspec archive` with sync) — apply both MODIFIED deltas to canonical `fs-datasource-engine` + `fs-sync-service` specs.
- [ ] 3.2 `openspec validate fs-datasource-engine --type spec` + `openspec validate fs-sync-service --type spec` — green.
- [ ] 3.3 `/opsx:archive` — move the change to `openspec/changes/archive/`.
