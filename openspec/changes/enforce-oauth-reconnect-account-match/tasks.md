## 1. Setup

- [x] 1.1 Create a sibling worktree at `.worktrees/enforce-oauth-reconnect-account-match/` and a branch off `master` (per `using-git-worktrees`; default sibling).
- [x] 1.2 Confirm baseline green in the worktree: `pnpm --filter @ft5/ipc-contracts build`, then engine + fs-sync + desktop targeted suites (record the baseline so regressions are attributable). <!-- Engine baseline 343 green pre-change; deps installed via pnpm install; ipc-contracts built. -->

## 2. Contracts + error taxonomy (`packages/ipc-contracts`)

- [x] 2.1 (TDD) Add a failing type/test asserting `DatasourceErrorTag.AccountMismatch === "account-mismatch"` and that the tag is part of the exported taxonomy.
- [x] 2.2 Add `account-mismatch` to the `DatasourceErrorTag` const object; make 2.1 green.
- [x] 2.3 (TDD) Add a failing test asserting the `AuthFailedTag` wire union includes `"account-mismatch"`.
- [x] 2.4 Add `"account-mismatch"` to the `AuthFailedTag` wire taxonomy; make 2.3 green.
- [x] 2.5 Document the `AuthResult.meta.account = { sub: string; email: string }` shape and add the optional `expectedAccount: { sub: string; email: string }` type used by `createForAuth`; build `@ft5/ipc-contracts`. <!-- Exported `AccountIdentity { sub; email }` (reused for meta.account + expectedAccount); meta stays Record<string,unknown>. createForAuth expectedAccount param landed in the engine package (6.1). -->

## 3. Error-tag tooling (`tools/`)

- [x] 3.1 Add `account-mismatch` to `tools/error-tag-vocabulary.mjs` (the shared vocab consumed by the lint rule and drift guard).
- [x] 3.2 Run the error-tag drift guard and `ft5/no-raw-error-tag-literal` lint over the repo; confirm the new tag is recognized and no raw-literal violations are introduced. <!-- Drift guard green at task 3. The const-convention grep guard (only run by the full ipc-contracts/full suite, NOT the per-package suites) later flagged the AuthFailedTag wire literals (broker emit + comparisons + test fixtures); paired WIRE_LITERAL_ALLOWLIST entries added in 85b2786 (rule-disables ⊆ allowlist). -->

## 4. Engine — account-identity capture (`packages/fs-datasource-engine`)

- [x] 4.1 (TDD) Google Drive: failing test that `doAuthenticateImpl`'s authorize URL requests `openid email` alongside the Drive scope and that `isScopeSufficient` still accepts the widened issued scope.
- [x] 4.2 (TDD) Google Drive: failing test that, given a token response with an `id_token`, the exchange validates `aud`/`iss`/`exp`, extracts `{ sub, email }`, and persists `AuthResult.meta.account`.
- [x] 4.3 (TDD) Google Drive: failing test that a missing/invalid/unparseable `id_token` throws a **retryable** `DatasourceError` and persists nothing (fail-closed).
- [x] 4.4 Implement Google Drive capture (scope widening + `id_token` parse/validate helper + `meta.account` write + fail-closed); make 4.1–4.3 green.
- [x] 4.5 (TDD) OneDrive: mirror 4.1–4.3 (scope `openid email`, `id_token` claims incl. pairwise `sub`, fail-closed). <!-- OneDrive issuer derived from the token's own `tid` claim (https://login.microsoftonline.com/<GUID>/v2.0, NEVER `common`); `email` claim may be absent → email "". -->
- [x] 4.6 Implement OneDrive capture; make 4.5 green.
- [x] 4.7 Add a shared `id_token` decode+validate helper (single implementation reused by both strategies) with its own unit tests (claim validation, expiry, malformed input). <!-- shared foundation: packages/fs-datasource-engine/src/oauth/id-token.ts (parseIdToken + IdTokenError) + __tests__/id-token.test.ts (13 tests). -->

## 5. Engine — refresh preserves the anchor

- [x] 5.1 (TDD) Google Drive: failing test that `refreshCredentials()` on a credential carrying `meta.account` re-emits the same `{ sub, email }` (refresh response has no `id_token`). <!-- Tested via refreshTokenImpl directly (existing test idiom); refreshCredentials single-flights refreshTokenImpl. -->
- [x] 5.2 (TDD) OneDrive: same refresh-preservation test.
- [x] 5.3 Implement anchor preservation in both `refreshTokenImpl` paths; make 5.1–5.2 green. <!-- parseTokenResponse({capture:false}) re-emits this.creds?.account onto meta.account; readCredsFromStored reads meta.account into creds. -->

## 6. Engine — reconnect enforcement (`createForAuth` + throw-before-persist)

- [x] 6.1 (TDD) `factory.createForAuth` accepts an optional `expectedAccount` and threads it to the OAuth strategy constructor (failing test on the new parameter + strategy field). <!-- FACTORY HALF (shared foundation, 77b9aa4): public createForAuth(providerId, oauthAppConfig, ctx, datasourceId?, expectedAccount?) + widened PreAuthFactoryFn 4th param. Per-provider strategy-CONSTRUCTOR field + post-exchange compare done in 6.2-6.5. -->
- [x] 6.2 (TDD) Strategy: failing test that with `expectedAccount` present and a matching `sub`, persistence proceeds normally (with preserved `meta.account`).
- [x] 6.3 (TDD) Strategy: failing test that with `expectedAccount` present and a **different** `sub`, the completion closure throws `DatasourceError { tag: "account-mismatch" }` carrying the expected email, and **no `CredentialStore.put` occurs** (assert the store is untouched — proves throw-before-persist, no rollback window). <!-- raw carries {expectedSub, expectedEmail, actualSub, actualEmail}; tests assert puts.length===0 for both providers. -->
- [x] 6.4 (TDD) Strategy: failing test that `expectedAccount` present adds `login_hint=<email>` to the authorize URL; and that absent `expectedAccount` performs capture only (no comparison, no `login_hint`). <!-- login_hint omitted when expectedAccount.email is "" (email-less account). -->
- [x] 6.5 Implement the `expectedAccount` thread + post-exchange compare + `login_hint`; make 6.1–6.4 green for both providers. <!-- Google 5f314fa, OneDrive e4d287c; engine suite 343→364 green. -->
- [x] 6.6 Code review (`requesting-code-review`) of the engine changes — critical = contract break / coverage regression / deviation from design.md Decisions. <!-- Covered by the whole-change adversarial code review (read-only subagent over master...HEAD) + per-slice spot-checks. id_token security / throw-before-persist / two error paths / refresh-preserve all rated CLEAN with non-vacuous tests. -->

## 7. fs-sync — anchor threading + broker tag mapping (`services/fs-sync`)

- [x] 7.1 (TDD) `sync:authenticate-start` reconnect path: failing test that an existing `datasourceId` with stored `meta.account` constructs the auth client with `expectedAccount`, and a datasource without one passes no anchor. <!-- OAuth reconnect path is the loopback broker (handler delegates the whole OAuth lifecycle incl. createForAuth to broker.start — authenticate-start.ts:139). Anchor read in broker.start(); tests assert createForAuth's 5th arg == stored meta.account, undefined for first-connect/legacy/no-sub. -->
- [x] 7.2 Implement the anchor read (`CredentialStore` → `meta.account`) + thread into `createForAuth` / broker `start`; make 7.1 green. <!-- readExpectedAccount(datasourceId) BEFORE server bind (no listener leak); gates on a non-empty `sub` ALONE — `email` is display-only (D1), normalized to "" (Microsoft/AAD id_tokens may omit email). Original sub+email gate (140b728-fixed) was the CRITICAL C1 the review caught. Blast-radius: ConfigFileCredentialStore.get threw ENOENT on a missing file — fixed to honor the get-returns-null port contract (Outcome-2 commit 14369fc). -->
- [x] 7.3 (TDD) Loopback broker: failing test that a `completeWith` rejection with `DatasourceError { tag: "account-mismatch" }` emits `auth-failed { tag: "account-mismatch", message }` naming the expected email, and emits no `credential-persisted`/`auth-completed`; other rejections still map to `provider-error`. <!-- Asserts structured expectedEmail/actualEmail lifted off err.raw + the missing-actualEmail best-effort case + the email-less-anchor-still-enforces C1 regression. -->
- [x] 7.4 Implement the broker catch mapping; make 7.3 green. <!-- 3f7b434: completeWith catch → auth-failed{tag:"account-mismatch", message, expectedEmail, actualEmail}; every other rejection (incl. fail-closed auth-expired) stays provider-error. -->
- [x] 7.5 Code review of the fs-sync changes. <!-- Covered by the whole-change adversarial review: broker mapping CLEAN; the anchor-read email gate flagged as CRITICAL C1 → fixed (140b728); ENOENT fix CLEAN (Outcome 2 cite correct). -->

## 8. Renderer — Wrong-account callout (per design.md `## Visual direction`)

- [x] 8.1 (TDD) Reconnect view (`invalid-datasource.tsx`): failing test that a failed session with `tag: "account-mismatch"` renders the full amber callout instead of the generic line, with Reconnect still live; other tags keep the generic copy. <!-- Copy assembled from STRUCTURED expectedEmail/actualEmail (D5), NOT message. + email-less fallback test (969174b). -->
- [x] 8.2 Implement the reconnect-view callout reading the structured fields; make 8.1 green. Match the locked tokens (light: `#92400e`/`#78350f`/`#fffbeb`/`#fcd34d`; dark: `#fcd34d`/`#fde68a`/`rgba(217,119,6,.13)`/`#a16207`), Lucide `alert-triangle`, `role="alert"`/`aria-live` retained. <!-- Idiomatic amber-* + dark: classes. Empty expectedEmail → generic "a different account" / "the originally-connected account" fallback; "You signed in as" clause renders only for a non-empty actualEmail. -->
- [x] 8.3 (TDD) Card banner (`card.tsx` `AuthErrorBanner`): failing test that `tag: "account-mismatch"` renders the condensed mini-callout; other tags keep existing copy. <!-- Driven via the live event stream (emit auth-failed after Reconnect records the correlationId). + email-less fallback test. -->
- [x] 8.4 Implement the card mini-callout; make 8.3 green (same token set, condensed layout). <!-- "Connect as {expectedEmail} to continue." / email-less → "Reconnect with the originally-connected account to continue." Reconnect button extracted + shared. -->
- [x] 8.5 Verify WCAG AA contrast (light + dark) for both surfaces and confirm the `scripts/motion-budget` / render-budget gates stay green (no new animation). <!-- AA PASS: light title 6.84:1 / body 8.75:1; dark title 11.45–12.62:1 / body 13.25–14.62:1; icons ≥3:1. motion-budget 20/20 + render-budget 1/1 green. -->
- [x] 8.6 Code review of the renderer changes — critical includes accessibility regression below WCAG AA and deviation from `## Visual direction`. <!-- Covered by the whole-change adversarial review: renderer rated CLEAN (structured-field copy, a11y retained, amber-not-destructive tokens). Empty-email blank callout flagged (advisor) → fixed (969174b). -->

## 9. Verification + close-out

- [x] 9.1 Full verification (`verification-before-completion`): engine + ipc-contracts + fs-sync + desktop targeted suites, `tsc -b`, lint (incl. the error-tag rule), `electron-vite` build. <!-- Full suite 308 files / 2882 passed / 0 fail / 10 skipped / no type errors (abi:node for DB suites); fresh `tsc -b` clean; `pnpm lint` clean repo-wide (incl. ft5/no-raw-error-tag-literal); electron-vite build green. -->
- [x] 9.2 `openspec validate enforce-oauth-reconnect-account-match --strict` (green before any sync/archive). <!-- valid (re-confirmed after the C1 spec-scenario correction). -->
- [x] 9.3 Advisor checkpoint #2 — before declaring done; make the deliverable durable first. <!-- Confirmed the C1 fix; flagged the electron-vite build (done) + the empty-email blank callout (fixed 969174b) + M1 (deferred to PENDING_TC). -->
- [ ] 9.4 Manual smoke against a running system: reconnect same account (succeeds), reconnect different account (hard-blocked, original datasource intact, callout shows expected account) on both Drive and OneDrive — record outcomes; defer to `PENDING_TC.MD` any flow not runnable against a real provider. <!-- DEFERRED to PENDING_TC.MD: needs a real OAuth provider (GCP/Azure app registration + two real accounts each), not configured here. The flow is automated-green end-to-end but never exercised against a live provider. Also defers M1 (untested readExpectedAccount real-read-error propagation). -->
- [ ] 9.5 Finish the branch via `finishing-a-development-branch` (test re-verify + pre-handoff backstop over `git log master..HEAD`).
