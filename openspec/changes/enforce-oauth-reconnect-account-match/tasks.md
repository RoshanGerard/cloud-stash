## 1. Setup

- [ ] 1.1 Create a sibling worktree at `.worktrees/enforce-oauth-reconnect-account-match/` and a branch off `master` (per `using-git-worktrees`; default sibling).
- [ ] 1.2 Confirm baseline green in the worktree: `pnpm --filter @ft5/ipc-contracts build`, then engine + fs-sync + desktop targeted suites (record the baseline so regressions are attributable).

## 2. Contracts + error taxonomy (`packages/ipc-contracts`)

- [ ] 2.1 (TDD) Add a failing type/test asserting `DatasourceErrorTag.AccountMismatch === "account-mismatch"` and that the tag is part of the exported taxonomy.
- [ ] 2.2 Add `account-mismatch` to the `DatasourceErrorTag` const object; make 2.1 green.
- [ ] 2.3 (TDD) Add a failing test asserting the `AuthFailedTag` wire union includes `"account-mismatch"`.
- [ ] 2.4 Add `"account-mismatch"` to the `AuthFailedTag` wire taxonomy; make 2.3 green.
- [ ] 2.5 Document the `AuthResult.meta.account = { sub: string; email: string }` shape and add the optional `expectedAccount: { sub: string; email: string }` type used by `createForAuth`; build `@ft5/ipc-contracts`.

## 3. Error-tag tooling (`tools/`)

- [ ] 3.1 Add `account-mismatch` to `tools/error-tag-vocabulary.mjs` (the shared vocab consumed by the lint rule and drift guard).
- [ ] 3.2 Run the error-tag drift guard and `ft5/no-raw-error-tag-literal` lint over the repo; confirm the new tag is recognized and no raw-literal violations are introduced.

## 4. Engine — account-identity capture (`packages/fs-datasource-engine`)

- [ ] 4.1 (TDD) Google Drive: failing test that `doAuthenticateImpl`'s authorize URL requests `openid email` alongside the Drive scope and that `isScopeSufficient` still accepts the widened issued scope.
- [ ] 4.2 (TDD) Google Drive: failing test that, given a token response with an `id_token`, the exchange validates `aud`/`iss`/`exp`, extracts `{ sub, email }`, and persists `AuthResult.meta.account`.
- [ ] 4.3 (TDD) Google Drive: failing test that a missing/invalid/unparseable `id_token` throws a **retryable** `DatasourceError` and persists nothing (fail-closed).
- [ ] 4.4 Implement Google Drive capture (scope widening + `id_token` parse/validate helper + `meta.account` write + fail-closed); make 4.1–4.3 green.
- [ ] 4.5 (TDD) OneDrive: mirror 4.1–4.3 (scope `openid email`, `id_token` claims incl. pairwise `sub`, fail-closed).
- [ ] 4.6 Implement OneDrive capture; make 4.5 green.
- [ ] 4.7 Add a shared `id_token` decode+validate helper (single implementation reused by both strategies) with its own unit tests (claim validation, expiry, malformed input).

## 5. Engine — refresh preserves the anchor

- [ ] 5.1 (TDD) Google Drive: failing test that `refreshCredentials()` on a credential carrying `meta.account` re-emits the same `{ sub, email }` (refresh response has no `id_token`).
- [ ] 5.2 (TDD) OneDrive: same refresh-preservation test.
- [ ] 5.3 Implement anchor preservation in both `refreshTokenImpl` paths; make 5.1–5.2 green.

## 6. Engine — reconnect enforcement (`createForAuth` + throw-before-persist)

- [ ] 6.1 (TDD) `factory.createForAuth` accepts an optional `expectedAccount` and threads it to the OAuth strategy constructor (failing test on the new parameter + strategy field).
- [ ] 6.2 (TDD) Strategy: failing test that with `expectedAccount` present and a matching `sub`, persistence proceeds normally (with preserved `meta.account`).
- [ ] 6.3 (TDD) Strategy: failing test that with `expectedAccount` present and a **different** `sub`, the completion closure throws `DatasourceError { tag: "account-mismatch" }` carrying the expected email, and **no `CredentialStore.put` occurs** (assert the store is untouched — proves throw-before-persist, no rollback window).
- [ ] 6.4 (TDD) Strategy: failing test that `expectedAccount` present adds `login_hint=<email>` to the authorize URL; and that absent `expectedAccount` performs capture only (no comparison, no `login_hint`).
- [ ] 6.5 Implement the `expectedAccount` thread + post-exchange compare + `login_hint`; make 6.1–6.4 green for both providers.
- [ ] 6.6 Code review (`requesting-code-review`) of the engine changes — critical = contract break / coverage regression / deviation from design.md Decisions.

## 7. fs-sync — anchor threading + broker tag mapping (`services/fs-sync`)

- [ ] 7.1 (TDD) `sync:authenticate-start` reconnect path: failing test that an existing `datasourceId` with stored `meta.account` constructs the auth client with `expectedAccount`, and a datasource without one passes no anchor.
- [ ] 7.2 Implement the anchor read (`CredentialStore` → `meta.account`) + thread into `createForAuth` / broker `start`; make 7.1 green.
- [ ] 7.3 (TDD) Loopback broker: failing test that a `completeWith` rejection with `DatasourceError { tag: "account-mismatch" }` emits `auth-failed { tag: "account-mismatch", message }` naming the expected email, and emits no `credential-persisted`/`auth-completed`; other rejections still map to `provider-error`.
- [ ] 7.4 Implement the broker catch mapping; make 7.3 green.
- [ ] 7.5 Code review of the fs-sync changes.

## 8. Renderer — Wrong-account callout (per design.md `## Visual direction`)

- [ ] 8.1 (TDD) Reconnect view (`invalid-datasource.tsx`): failing test that a failed session with `tag: "account-mismatch"` renders the full amber callout (title "Wrong account", expected + actual account from `message`) instead of the generic line, with Reconnect still live; other tags keep the generic copy.
- [ ] 8.2 Implement the reconnect-view callout reading `sessionState.tag`/`message`; make 8.1 green. Match the locked tokens (light: `#92400e`/`#78350f`/`#fffbeb`/`#fcd34d`; dark: `#fcd34d`/`#fde68a`/`rgba(217,119,6,.13)`/`#a16207`), Lucide `alert-triangle`, `role="alert"`/`aria-live` retained.
- [ ] 8.3 (TDD) Card banner (`card.tsx` `AuthErrorBanner`): failing test that `tag: "account-mismatch"` renders the condensed mini-callout (title "Wrong account", expected account, Reconnect inside); other tags keep existing copy.
- [ ] 8.4 Implement the card mini-callout; make 8.3 green (same token set, condensed layout).
- [ ] 8.5 Verify WCAG AA contrast (light + dark) for both surfaces and confirm the `scripts/motion-budget` / render-budget gates stay green (no new animation).
- [ ] 8.6 Code review of the renderer changes — critical includes accessibility regression below WCAG AA and deviation from `## Visual direction`.

## 9. Verification + close-out

- [ ] 9.1 Full verification (`verification-before-completion`): engine + ipc-contracts + fs-sync + desktop targeted suites, `tsc -b`, lint (incl. the error-tag rule), `electron-vite` build.
- [ ] 9.2 `openspec validate enforce-oauth-reconnect-account-match --strict` (green before any sync/archive).
- [ ] 9.3 Advisor checkpoint #2 — before declaring done; make the deliverable durable first.
- [ ] 9.4 Manual smoke against a running system: reconnect same account (succeeds), reconnect different account (hard-blocked, original datasource intact, callout shows expected account) on both Drive and OneDrive — record outcomes; defer to `PENDING_TC.MD` any flow not runnable against a real provider.
- [ ] 9.5 Finish the branch via `finishing-a-development-branch` (test re-verify + pre-handoff backstop over `git log master..HEAD`).
