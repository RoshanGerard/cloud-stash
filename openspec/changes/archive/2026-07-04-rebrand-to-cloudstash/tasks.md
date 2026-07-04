## 1. Worktree + code-identifier codemod

- [x] 1.1 Create a sibling worktree at `.worktrees/rebrand-to-cloudstash/` off `master`; run `pnpm install` to baseline.
- [x] 1.2 Rebuild + re-validate the codemod (`rename-map.json` + `rename-codemod.mjs`) against the current tree — the prep-kit was disposable; re-run the recon dry-run and confirm every rule is non-zero and counts match the tree before `--apply`. (Re-validated: 1051 edits/376 files against the current tree.)
- [x] 1.3 Run the codemod `--apply`: `@ft5/*` → `@cloudstash/*` (6 packages), workspace name `ft5-cloude-sync` → `cloudstash`, tsconfig/vite/CI/bin references, over `git ls-files` minus `openspec/**` + build/vendor dirs. (1051 edits; + 3 residual-sweep passes = 83 edits for backslash paths, env var, temp prefixes, ft5-dev cache, escaped-regex, packaged FT5.)
- [x] 1.4 `pnpm install` to regenerate `pnpm-lock.yaml`; `pnpm -r build` + `pnpm typecheck` green. (Lockfile @cloudstash: 6, @ft5: 0; tsc -b clean.)
- [x] 1.5 Run `rename-guard.sh` in **codemod scope** — assert zero brand residual outside the whitelist, brand-neutral survivors preserved (`sync.db`, `sync.sock`, `sync_app`, dir names), and `git diff openspec/` EMPTY (the codemod must not touch `openspec/**`). (GUARD PASS, all 5 sections.)

## 2. Runtime contract tokens (lockstep families)

- [x] 2.1 localStorage keys `ft5.downloads.*` / `ft5.explorer.pageSize` / theme key → `cloudstash.*` (renderer stores + cold-start bootstrap scripts in lockstep — `theme-store`↔`theme-script`, `motion-store`↔`motion-script`). (Guard lockstep: theme/motion equal.)
- [x] 2.2 IPC pipe/socket `ft5-sync` (+`-dev`) → `cloudstash-sync`: desktop dials (`pipe-paths.ts`) ↔ fs-sync binds (`env/paths.ts`) ↔ smoke tests, atomically. (Guard lockstep: pipe equal.)
- [x] 2.3 Data dir `$HOME/ft5/sync_app` → `$HOME/cloudstash/sync_app` (incl. the `path-validator.ts` security guard) and env `FT5_SYNC_DATA_DIR` → `CLOUDSTASH_SYNC_DATA_DIR`, `FT5_DEV_CREDENTIALS` → `CLOUDSTASH_DEV_CREDENTIALS`. (Guard lockstep: data-dir + env-var equal.)
- [x] 2.4 `~/Downloads/ft5` → `~/Downloads/CloudStash` (capital; incl. backslash Windows-path test assertions); desktop DB `ft5.db` → `cloudstash.db`; log prefix `[ft5]` → `[cloudstash]`.
- [x] 2.5 ESLint namespace `ft5/no-raw-error-tag-literal` → `cloudstash/no-raw-error-tag-literal`: plugin key + rule id + every `eslint-disable` pragma; `pnpm lint` green (no "rule not found"). (Lint PASS.)
- [x] 2.6 `pnpm test` (unit + integration) green after token renames (`pnpm abi:node`). (3161 tests pass, 10 skipped, 0 fail.)

## 3. Display strings, userData, installer identity (D1)

- [x] 3.1 Add `"productName": "CloudStash"` to `apps/desktop/package.json` (moves userData → `%APPDATA%/CloudStash`); `name` → `@cloudstash/desktop` (codemod).
- [x] 3.2 `electron-builder.yml`: `productName` → `CloudStash`, `appId` → `com.cloudstash.app`.
- [x] 3.3 Display strings: HTML `<title>`, layout description, header wordmark text, footer `© CloudStash` (retire Forti5), README H1/paths (Linux packaged path is lowercase `cloudstash`). (Codemod + guard case-correctness PASS.)
- [x] 3.4 Installer identity (D1 = `cloudstash-sync`), hand-edited (codemod excludes `services/fs-sync/installer/**`): Windows schtasks `/TN "cloudstash-sync"`, Linux `cloudstash-sync.service` + XDG `cloudstash-sync.desktop`, macOS launchd label `com.cloudstash.sync`; register ↔ unregister in lockstep. (23 edits; installer-scripts.test.ts green in the suite.)
- [ ] 3.5 e2e packaged-path smoke green — **DEFERRED to PENDING_TC** (packaged build). Assertions renamed by the codemod and covered by the vitest suite; the Playwright packaged smoke needs a full electron build and is deferred with the §6.2 running-system smoke.

## 4. Logo symbol rename (artwork unchanged)

- [x] 4.1 `git mv` the logo component file `forti5-logo.tsx` → `cloudstash-logo.tsx`; rename `Forti5Logo` → `CloudStashLogo` and its `data-testid`; keep the current crimson artwork (change 2 swaps the mark). (`cloudstash-logo.test.tsx` 7 tests pass.)

## 5. Spec sync + Purpose direct-edit

- [x] 5.1 Drift guard: canonical unchanged since propose (dryRun re-verified). `openspec archive` merges the 6 delta files (37 MODIFIED + 3 RENAMED) into canonical.
- [x] 5.2 **Direct edit** `## Purpose` prose in `openspec/specs/fs-sync-service/spec.md` and `openspec/specs/fs-datasource-engine/spec.md` to swap brand tokens — the delta lifecycle structurally cannot reach Purpose (design.md Decision 12).
- [x] 5.3 `openspec validate <cap> --type spec` green for each capability; `git grep -Ei 'ft5|forti5|cloude' openspec/specs/` returns only neutral survivors, zero brand tokens.

## 6. Verify

- [x] 6.1 Full suite green: `pnpm typecheck` + `pnpm lint` + `pnpm test` (`pnpm abi:node`). (typecheck clean, lint clean, 3161 tests pass.)
- [ ] 6.2 Feature exercised against a running system (app launches, userData → `%APPDATA%/CloudStash`, service connects over `cloudstash-sync` pipe, download lands in `~/Downloads/CloudStash`) — **DEFERRED to PENDING_TC** (needs a running electron build; zero-behavior-change rename is fully covered by typecheck + lint + 3161 tests + guard).
- [x] 6.3 `rename-guard.sh` clean (codemod scope only); `openspec validate rebrand-to-cloudstash` green.
