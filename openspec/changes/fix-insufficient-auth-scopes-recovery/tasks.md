## 1. Pre-apply

- [ ] 1.1 Visual-refinement pass complete: the auth-error callout's headline/detail/palette are converged via `superpowers:brainstorming` (Visual Companion) and recorded in `design.md ## Visual direction` (starting point = the merged sibling's pre-specified "Auth-error slot").
- [ ] 1.2 Human review of the proposed artifacts (proposal/design/specs/tasks) approved.
- [ ] 1.3 Worktree created at `.worktrees/fix-insufficient-auth-scopes-recovery/` on a branch off the parent tip `feature/reconnect-auth-recovery-stubs` (NOT master). Baseline green: `pnpm abi:node` then targeted suites pass before any change.

## 2. Engine — Google Drive runtime 403 insufficient-scope reclassification (TDD)

- [ ] 2.1 RED: in `packages/fs-datasource-engine/src/strategies/googledrive-client.test.ts` (alongside the existing 403-`reason` cases ~line 1763), add failing tests: a 403 with inner reason `insufficientPermissions` → `tag === "auth-revoked"`, `retryable === false`, `raw.kind === "scope-insufficient"`, `raw.requiredScope === REQUIRED_DRIVE_SCOPE`, and `message` preserves the provider string; a 403 with reason `ACCESS_TOKEN_SCOPE_INSUFFICIENT` → same; a non-regression case asserting `quotaExceeded` / `dailyLimitExceeded` / `domainPolicy` / `insufficientFilePermissions` still → `provider-error` (no `scope-insufficient`).
- [ ] 2.2 GREEN: in `googledrive-client.ts` `normalizeErrorImpl`, add the `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT` branch BEFORE the catch-all `provider-error`, constructing the `DatasourceError` directly (NOT via `mk()`, whose `raw` is the original error) with `tag: AuthRevoked`, `raw: { kind: "scope-insufficient", requiredScope: REQUIRED_DRIVE_SCOPE }`, `message: <provider message>` — mirroring `checkScopeSufficiency`. Watch the new tests pass; full engine suite stays green.
- [ ] 2.3 Confirm the shared `strategy-contract.ts` suite still passes unchanged (no new hook — the auth-failure contract scenario primes a generic auth failure, not this 403). No cross-strategy contract edit.

## 3. Contract — `FilesErrorEnvelope.authErrorKind` (TDD)

- [ ] 3.1 RED: in `packages/ipc-contracts/src/__tests__/files.test-d.ts` add a type test asserting `FilesErrorEnvelope.authErrorKind` is optional and accepts `"scope-insufficient"`.
- [ ] 3.2 GREEN: add `authErrorKind?: "scope-insufficient"` to `FilesErrorEnvelope` in `packages/ipc-contracts/src/files.ts` (flat-optional, documented mirroring `existingPath`). Rebuild ipc-contracts (`pnpm --filter @ft5/ipc-contracts build`) so downstream value/type imports resolve.

## 4. fs-sync — thread `authErrorKind` from `raw.kind` (TDD)

- [ ] 4.1 RED: in `services/fs-sync/src/commands/__tests__/files-error-mapping.test.ts` (or the colocated test) add failing tests: an `auth-revoked` `DatasourceError` with `raw.kind === "scope-insufficient"` → envelope `authErrorKind === "scope-insufficient"`; an error without that `raw.kind` → field omitted; assert no side effect (pure).
- [ ] 4.2 GREEN: add `authErrorKind?` to `FilesErrorEnvelopeInner` and a defensive `readAuthErrorKind(raw)` in `services/fs-sync/src/commands/files-error-mapping.ts` (mirroring `readExistingPath`); set the field when `raw.kind === "scope-insufficient"`. Keep `normalizeFilesError` pure — no `credentialStore`, no eviction. `files:list` deps unchanged.

## 5. Renderer — store slot + prop threading + auth-error callout (TDD)

- [ ] 5.1 RED: in the file-explorer store tests, add a failing test that a `files:list` error envelope carrying `authErrorKind: "scope-insufficient"` populates a new `authErrorKind` state slot (parallel to `error` / `errorTag`).
- [ ] 5.2 GREEN: add the `authErrorKind` slot + setter to `apps/desktop/src/renderer/src/features/file-explorer/store.ts` and capture it from the list error envelope alongside `error` / `errorTag`.
- [ ] 5.3 RED: in `apps/desktop/src/renderer/src/features/file-explorer/states/__tests__/invalid-datasource.test.tsx` add failing tests: with `authErrorKind="scope-insufficient"` + a message prop, the dormant seam renders the destructive callout with headline "Google Drive needs full-access permission" + detail "Authentication error: \<message\>", and Reconnect + Remove remain present; without `authErrorKind`, no callout renders (existing copy unchanged — non-regression).
- [ ] 5.4 GREEN: thread `authErrorKind` + the engine `message` from the store through `<InvalidDatasourceArm>` (in `file-explorer.tsx`) into new `<InvalidDatasourceState>` props; fill the dormant auth-error slot (~`invalid-datasource.tsx:389-396`) with the provider-parameterized headline (from `providerDisplayName`) + the "Authentication error: \<message\>" detail, per `design.md ## Visual direction`. Motion-free, WCAG AA, icon `aria-hidden`.
- [ ] 5.5 Confirm the existing reconnect-view tests (initial / pending / dead-end / account-mismatch) all stay green — the callout is additive and gated on `authErrorKind`.

## 6. Verification, review, audit

- [ ] 6.1 Code review (`requesting-code-review`) between the engine/contract/fs-sync work and the renderer work; critical issues block.
- [ ] 6.2 Full verification: `pnpm abi:node` then full repo `pnpm -w test --run` (engine + ipc-contracts + fs-sync + desktop), `tsc -b`, lint, and `scripts/motion-budget.test.ts` all green.
- [ ] 6.3 Reactive/contract audit gate: this change ADDS the `authErrorKind` field + a new error mapping + a new renderer scenario (Outcome 3 — contract changed) — confirmed covered by the three spec deltas (engine + fs-sync + file-explorer). No uncovered contract change.
- [ ] 6.4 `openspec validate fix-insufficient-auth-scopes-recovery --strict` green.

## 7. Archive + finish

- [ ] 7.1 Advisor checkpoint #2 (before archive) — verify the as-built matches the artifacts.
- [ ] 7.2 `/opsx:archive` — sync the three deltas to canonical; `openspec validate <cap> --type spec` per touched capability green.
- [ ] 7.3 `finishing-a-development-branch` — re-verify tests + pre-handoff backstop over `git log <parent>..HEAD`, then FF/merge into the SAME parent `feature/reconnect-auth-recovery-stubs` (NOT master). Record any deferred smokes (real-provider Drive insufficient-scope; OneDrive equivalent; Q6 proactive-pre-empt investigation) in `PENDING_TC.MD`.
