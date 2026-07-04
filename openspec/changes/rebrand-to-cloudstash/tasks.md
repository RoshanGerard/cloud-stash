## 1. Worktree + code-identifier codemod

- [ ] 1.1 Create a sibling worktree at `.worktrees/rebrand-to-cloudstash/` off `master`; run `pnpm install` to baseline.
- [ ] 1.2 Rebuild + re-validate the codemod (`rename-map.json` + `rename-codemod.mjs`) against the current tree — the prep-kit was disposable; re-run the recon dry-run and confirm every rule is non-zero and counts match the tree before `--apply`.
- [ ] 1.3 Run the codemod `--apply`: `@ft5/*` → `@cloudstash/*` (6 packages), workspace name `ft5-cloude-sync` → `cloudstash`, tsconfig/vite/CI/bin references, over `git ls-files` minus `openspec/**` + build/vendor dirs.
- [ ] 1.4 `pnpm install` to regenerate `pnpm-lock.yaml`; `pnpm -r build` + `pnpm typecheck` green.
- [ ] 1.5 Run `rename-guard.sh` in **codemod scope** — assert zero brand residual outside the whitelist, brand-neutral survivors preserved (`sync.db`, `sync.sock`, `sync_app`, dir names), and `git diff openspec/` EMPTY (the codemod must not touch `openspec/**`).

## 2. Runtime contract tokens (lockstep families)

- [ ] 2.1 localStorage keys `ft5.downloads.*` / `ft5.explorer.pageSize` / theme key → `cloudstash.*` (renderer stores + cold-start bootstrap scripts in lockstep — `theme-store`↔`theme-script`, `motion-store`↔`motion-script`).
- [ ] 2.2 IPC pipe/socket `ft5-sync` (+`-dev`) → `cloudstash-sync`: desktop dials (`pipe-paths.ts`) ↔ fs-sync binds (`env/paths.ts`) ↔ smoke tests, atomically.
- [ ] 2.3 Data dir `$HOME/ft5/sync_app` → `$HOME/cloudstash/sync_app` (incl. the `path-validator.ts` security guard) and env `FT5_SYNC_DATA_DIR` → `CLOUDSTASH_SYNC_DATA_DIR`, `FT5_DEV_CREDENTIALS` → `CLOUDSTASH_DEV_CREDENTIALS`.
- [ ] 2.4 `~/Downloads/ft5` → `~/Downloads/CloudStash` (capital); desktop DB `ft5.db` → `cloudstash.db`; log prefix `[ft5]` → `[cloudstash]`.
- [ ] 2.5 ESLint namespace `ft5/no-raw-error-tag-literal` → `cloudstash/no-raw-error-tag-literal`: plugin key + rule id + every `eslint-disable` pragma in ONE commit; `pnpm lint` green (no "rule not found").
- [ ] 2.6 `pnpm test` (unit + integration) green after token renames (`pnpm abi:node` in main checkout for the better-sqlite3 ABI).

## 3. Display strings, userData, installer identity (D1)

- [ ] 3.1 Add `"productName": "CloudStash"` to `apps/desktop/package.json` (moves userData → `%APPDATA%/CloudStash`); `name` → `@cloudstash/desktop` (codemod).
- [ ] 3.2 `electron-builder.yml`: `productName` → `CloudStash`, `appId` → `com.cloudstash.app`.
- [ ] 3.3 Display strings: HTML `<title>`, layout description, header wordmark text, footer `© CloudStash` (retire Forti5), README H1/paths (Linux packaged path is lowercase `cloudstash`). Polish `<title>` + README H1 to display-case `CloudStash` (D2).
- [ ] 3.4 Installer identity (D1 = `cloudstash-sync`), hand-edited (codemod excludes `services/fs-sync/installer/**`): Windows schtasks `/TN "cloudstash-sync"`, Linux `cloudstash-sync.service` + XDG `cloudstash-sync.desktop`, macOS launchd label `com.cloudstash.sync`; register ↔ unregister in lockstep + `installer-scripts.test.ts` assertions.
- [ ] 3.5 e2e packaged-path assertions (`ping.spec`, `file-explorer.spec`) updated to the new productName paths; packaged-path smoke green.

## 4. Logo symbol rename (artwork unchanged)

- [ ] 4.1 `git mv` the logo component file `forti5-logo.tsx` → `cloudstash-logo.tsx`; rename `Forti5Logo` → `CloudStashLogo` and its `data-testid`; keep the current crimson artwork (change 2 swaps the mark).

## 5. Spec sync + Purpose direct-edit

- [ ] 5.1 **Drift guard:** if any of the 6 canonical specs changed since propose (e.g. a sibling change synced first), re-run `gen-spec-deltas.mjs` + `trial-sync.mjs` (dryRun) — RENAMED FROM headings / MODIFIED blocks must still match. Then `/opsx:sync` to merge the 6 delta files (37 MODIFIED + 3 RENAMED) into canonical — mechanics already dryRun-verified against today's canonical.
- [ ] 5.2 **Direct edit** `## Purpose` prose in `openspec/specs/fs-sync-service/spec.md` and `openspec/specs/fs-datasource-engine/spec.md` to swap brand tokens (`ft5-cloude-sync`, `@ft5/*`, `$HOME/ft5/sync_app`, pipe `ft5-sync`) — the delta lifecycle structurally cannot reach Purpose (design.md Decision 12). Commit with the sync.
- [ ] 5.3 `openspec validate <cap> --type spec` green for each of the 6 capabilities; `git grep -Ei 'ft5|forti5|cloude' openspec/specs/` returns only intentionally-neutral survivors (e.g. `sync.db`, `sync_app`), zero brand tokens.

## 6. Verify

- [ ] 6.1 Full suite green: `pnpm typecheck` + `pnpm lint` + `pnpm test` (`pnpm abi:node`) + e2e.
- [ ] 6.2 Feature exercised against a running system: app launches, userData resolves to `%APPDATA%/CloudStash`, sync service connects over the `cloudstash-sync` pipe, a download lands in `~/Downloads/CloudStash`.
- [ ] 6.3 `rename-guard.sh` clean (codemod scope only — NOT run against the sanctioned `openspec/specs/` sync + Purpose edit); `openspec validate rebrand-to-cloudstash` green.
