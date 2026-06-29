## 1. Pre-apply

- [x] 1.1 Visual-refinement pass complete: the auth-error callout's headline/detail/palette are converged via `superpowers:brainstorming` (text-only — companion declined) and recorded in `design.md ## Visual direction` (starting point = the merged sibling's pre-specified "Auth-error slot"; AA-safe literal-red palette landed after the adversarial review).
- [x] 1.2 Human review of the proposed artifacts (proposal/design/specs/tasks) approved.
- [x] 1.3 Baseline green. NOTE: user chose **in-place on the parent branch** `feature/reconnect-auth-recovery-stubs` (not a worktree); `pnpm abi:node` + targeted suites green before any change.

## 2. Engine — Google Drive runtime 403 insufficient-scope reclassification (TDD)

- [x] 2.1 RED: in `packages/fs-datasource-engine/src/strategies/googledrive-client.test.ts` (alongside the existing 403-`reason` cases ~line 1763), add failing tests: a 403 with inner reason `insufficientPermissions` → `tag === "auth-revoked"`, `retryable === false`, `raw.kind === "scope-insufficient"`, `raw.requiredScope === REQUIRED_DRIVE_SCOPE`, and `message` preserves the provider string; a 403 with reason `ACCESS_TOKEN_SCOPE_INSUFFICIENT` → same; a non-regression case asserting `quotaExceeded` / `dailyLimitExceeded` / `domainPolicy` / `insufficientFilePermissions` still → `provider-error` (no `scope-insufficient`).
- [x] 2.2 GREEN: in `googledrive-client.ts` `normalizeErrorImpl`, add the `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT` branch BEFORE the catch-all `provider-error`, constructing the `DatasourceError` directly (NOT via `mk()`, whose `raw` is the original error) with `tag: AuthRevoked`, `raw: { kind: "scope-insufficient", requiredScope: REQUIRED_DRIVE_SCOPE }`, `message: <provider message>` — mirroring `checkScopeSufficiency`. Watch the new tests pass; full engine suite stays green.
- [x] 2.3 Confirm the shared `strategy-contract.ts` suite still passes unchanged (no new hook — the auth-failure contract scenario primes a generic auth failure, not this 403). No cross-strategy contract edit.

## 3. Contract — `FilesErrorEnvelope.authErrorKind` (TDD)

- [x] 3.1 RED: in `packages/ipc-contracts/src/__tests__/files.test-d.ts` add a type test asserting `FilesErrorEnvelope.authErrorKind` is optional and accepts `"scope-insufficient"`.
- [x] 3.2 GREEN: add `authErrorKind?: "scope-insufficient"` to `FilesErrorEnvelope` in `packages/ipc-contracts/src/files.ts` (flat-optional, documented mirroring `existingPath`). Rebuilt ipc-contracts so downstream value/type imports resolve; updated the 5 enumerated error-shape `toEqualTypeOf` blocks.

## 4. fs-sync — thread `authErrorKind` from `raw.kind` (TDD)

- [x] 4.1 RED: in `services/fs-sync/src/commands/files-error-mapping.test.ts` add failing tests: an `auth-revoked` `DatasourceError` with `raw.kind === "scope-insufficient"` → envelope `authErrorKind === "scope-insufficient"`; errors without that `raw.kind` (absent / non-object / `null` / wrong kind) → field omitted; assert no side effect (pure).
- [x] 4.2 GREEN: add `authErrorKind?` to `FilesErrorEnvelopeInner` and a defensive `readAuthErrorKind(raw)` in `services/fs-sync/src/commands/files-error-mapping.ts` (mirroring `readExistingPath`); set the field when `raw.kind === "scope-insufficient"`. Keep `normalizeFilesError` pure — no `credentialStore`, no eviction. `files:list` deps unchanged.

## 5. Renderer — store slot + prop threading + auth-error callout (TDD)

- [x] 5.1 RED: file-explorer store test asserting a new `authErrorKind` slot/setter (parallel to `error` / `errorTag`).
- [x] 5.2 GREEN: add the `authErrorKind` slot + setter to `store.ts`; capture it in `use-explorer-data.ts` from the list error envelope alongside `error` / `errorTag` (clear on start/success/catch).
- [x] 5.3 RED: in `invalid-datasource.test.tsx` add failing tests: `authErrorKind="scope-insufficient"` + message → destructive callout with headline "Google Drive needs full-access permission" + detail "Authentication error: \<message\>", Reconnect + Remove present; without `authErrorKind`, no callout (non-regression); provider-parameterized headline; pending + account-mismatch precedence; null-message fallback.
- [x] 5.4 GREEN: thread `authErrorKind` + the engine `message` from the store through `<InvalidDatasourceArm>` (`file-explorer.tsx`) into new `<InvalidDatasourceState>` props; fill the auth-error slot with the provider-parameterized headline + detail; suppress the misleading generic body; `showAuthError = authErrorKind === "scope-insufficient" && !isWaiting && !isAccountMismatch`. Motion-free, WCAG-AA (literal-red palette per the a11y review), icon `aria-hidden`.
- [x] 5.5 Existing reconnect-view tests (initial / pending / dead-end / account-mismatch) all stay green — the callout is additive and gated on `authErrorKind`.

## 6. Verification, review, audit

- [x] 6.1 Review: ran a 6-lens adversarial-verification **workflow** (contract-fidelity, account-match-regression, spec-coverage, a11y-motion, test-quality, completeness) over the diff. 1 CRITICAL (WCAG AA contrast) + doc/coverage findings — ALL fixed (literal-red palette; design/proposal "free bonus" overclaim corrected; +1 end-to-end composite test + 4 edge-case tests). Re-verified green.
- [x] 6.2 Full verification: `pnpm abi:node` then full repo `pnpm -w test` — 322 files / 3072 passed / 0 fail; `tsc -b` exit 0; `eslint .` exit 0; `scripts/motion-budget.test.ts` green (callout motion-free).
- [x] 6.3 Reactive/contract audit gate: ADDS `authErrorKind` field + a new error mapping + a new renderer scenario (Outcome 3 — contract changed) — covered by the three spec deltas (engine + fs-sync + file-explorer). No uncovered contract change.
- [x] 6.4 `openspec validate fix-insufficient-auth-scopes-recovery --strict` green.

## 7. Archive + finish

- [ ] 7.1 Advisor checkpoint #2 (before archive) — verify the as-built matches the artifacts. (Advisor environmentally overloaded on the apply turn — retry before archiving; the 6-lens workflow already validated as-built vs artifacts.)
- [ ] 7.2 `/opsx:archive` — sync the three deltas to canonical; `openspec validate <cap> --type spec` per touched capability green.
- [ ] 7.3 `finishing-a-development-branch` — re-verify tests + pre-handoff backstop over `git log <parent>..HEAD`, then FF/merge into the SAME parent `feature/reconnect-auth-recovery-stubs` (NOT master). Record deferred smokes (real-provider Drive insufficient-scope; OneDrive equivalent; Q6 proactive-pre-empt investigation; unify the proactive path onto the callout) in `PENDING_TC.MD`.
