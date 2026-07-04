## Context

`ft5-cloude-sync` is a pnpm-monorepo Electron app (desktop shell + Next.js static-export renderer + a per-user Node.js sync service + supporting engine/monitor packages) published under the `@ft5/*` scope with the "Forti5" vendor identity. It is pre-release (v0.0.0), so there are no shipped installs to migrate and no external consumers of the `@ft5/*` package names.

The rebrand to **CloudStash** is decomposed into three sequenced changes: (1) this one — a faithful, mechanical rename of identifiers, display strings, and runtime-contract tokens with **zero behavior or visual change**; (2) `restyle-cloudstash-monochrome` — the monochrome-dark visual identity; (3) `add-frameless-window-chrome`. Keeping the rename isolated means each stage is independently green and reviewable.

The brand tokens are scattered across three registers that must be handled differently:
- **Code identifiers & display strings** (package scopes, workspace name, the `Forti5Logo` symbol, product name, wordmark text, footer, README) — mechanical find/replace.
- **Runtime-contract tokens** (localStorage keys, data-dir path, IPC pipe/socket name, env vars, DB filename, launchd/schtasks/systemd identity, download folder) — also find/replace in code, but each is *documented in a canonical spec*, so it additionally needs a MODIFIED spec delta authored through the OpenSpec lifecycle.
- **Canonical specs** under `openspec/specs/**` — renamed ONLY via the spec deltas in this change, never by the codemod (Hard rule: never modify `openspec/specs/` directly / never shell-op `openspec/`).

## Goals / Non-Goals

**Goals:**
- A complete, faithful rename: no `ft5`/`forti5`/`cloude` brand residue except an explicitly whitelisted set (person/company email fixture, deprecated OAuth env-var comments if left, a dev display-name).
- Zero behavior change and zero visual change — the app runs and looks identical, only renamed.
- userData relocates cleanly to `%APPDATA%/CloudStash` via a declarative `productName`, touching no runtime code.
- Each stage (code identifiers → runtime tokens → display strings) independently typechecks/tests green.
- Runtime-contract token renames land in lockstep with their spec deltas so the specs never drift from the code.

**Non-Goals:**
- Any pixel/visual/logo/token/theme/font change → `restyle-cloudstash-monochrome` (change 2). This change renames the `Forti5Logo` *symbol/file* but keeps the current crimson artwork.
- Frameless window chrome → `add-frameless-window-chrome` (change 3).
- Data migration — none; pre-release, the old userData folder is simply orphaned and the app starts fresh.
- Code-signing / notarization certificates — out-of-band ops (CI secrets); a signed CloudStash-branded installer requires certs obtained separately. Flagged as a release risk, not a code change here.
- Re-aligning the 5 unstarted `openspec/changes/` stubs — done after this rebrand.

## Decisions

1. **Full rename incl. code identifiers**, not display-only. Rationale: the maximal-scope decision was made deliberately; a display-only rename would leave `@ft5/*` imports and the Forti5 vendor identity in place, contradicting "retire Forti5 entirely." Alternative (display strings only) rejected.

2. **Retire Forti5 entirely** — new vendor identity, footer `© CloudStash`, `appId: com.cloudstash.app`. Alternative (keep `tech.forti5.*` reverse-DNS) rejected: it would strand the old vendor namespace in the macOS `CFBundleIdentifier` and Windows AppUserModelID.

3. **No data migration.** Pre-release; userData becomes fresh. Empirically confirmed: the desktop DB is at `app.getPath("userData")/ft5.db` and `app.getName()` derives from `productName` (absent today) then `name` (`@ft5/desktop`), so userData is currently `%APPDATA%/@ft5/desktop` (verified on disk). **Fix = add top-level `"productName": "CloudStash"` to `apps/desktop/package.json`** — `productName` wins in all modes (dev and packaged), so `app.getName()` → `CloudStash` → userData `%APPDATA%/CloudStash`. Preferred over `app.setName()`/`app.setPath()` because it is declarative and touches no runtime code. `name` also becomes `@cloudstash/desktop` (consistency, via codemod). The old `%APPDATA%/@ft5/desktop` profile and `~/ft5/sync_app` credentials are orphaned by design.

4. **Chase all runtime-contract tokens, not just display strings.** Each spec-documented token (localStorage keys, data-dir, pipe/socket, env vars, DB name, install-identity, download folder, eslint namespace) gets a MODIFIED spec delta so the contract stays documented. Alternative (rename code but leave specs) rejected — it violates the audit gate (contract changed) and drifts spec from code.

5. **ESLint namespace renamed** `ft5/` → `cloudstash/` (custom rule `no-raw-error-tag-literal`), including the plugin key in `eslint.config.mjs`, the rule id, and every `eslint-disable` pragma — as one atomic change, or lint fails with "rule not found."

6. **Deterministic ordered codemod + grep-guard is the rename mechanism.** An ordered, most-specific-first, over-match-safe find/replace list (~22 rules) runs over `git ls-files` minus `openspec/**` and build/vendor dirs; then a `git grep`-based guard asserts (a) zero residual brand token outside the whitelist, (b) brand-neutral survivors preserved (`sync.db`, `sync.sock`, `sync_app`, dir names), (c) lockstep families equal, (d) `git diff openspec/` empty. **The guard IS the review** — a 371-file sweep cannot be meaningfully two-stage code-reviewed line by line, so correctness is enforced by the guard's invariants plus the full test/build/e2e suite on the renamed tree. This method is presented for ratification at review, not treated as settled.

   Over-match safety (the load-bearing detail): never a bare `ft5`/`FT5`/`forti5` replace. Full reverse-DNS literals first (`tech.forti5.ft5-cloude-sync` → `com.cloudstash.app`, `tech.forti5.ft5-sync` → `com.cloudstash.sync`) before stems; `Forti5` → `CloudStash` case-sensitive; bare `ft5` resolves to lowercase `cloudstash` (data-dir segment) vs capital `CloudStash` (Downloads subfolder) by context-specific rules; `ft5-sync` → `cloudstash-sync` for the transport pipe but EXCLUDING `services/fs-sync/installer/**` (that is the install-identity, decided separately in D1).

7. **Lockstep transport + identity rename.** The pipe/socket, data-dir, env var, and install-identity change atomically across desktop (dials), fs-sync (binds/listens), and installer scripts (register/unregister per OS), and the service is reinstalled. Divergence = broken runtime. Lockstep families enumerated in Risks.

8. **D1 — service install-identity = `cloudstash-sync`.** Windows schtasks `/TN "cloudstash-sync"`, Linux systemd `cloudstash-sync.service` + XDG `cloudstash-sync.desktop`, macOS launchd label `com.cloudstash.sync` (reverse-DNS is the mac convention; codemod rule handles the label, installer scripts hand-edited for the non-reverse-DNS names). Alternative (reverse-DNS task/unit names like `com.cloudstash.sync` everywhere) rejected as non-idiomatic on Windows/Linux.

9. **`Forti5Logo` symbol renames, artwork does not.** The component/file/`data-testid` rename to `CloudStashLogo` happens here; the SVG still uses the current crimson `var(--brand-primary)`. Change 2 swaps the artwork to the monochrome mark. Keeps change 1 free of any visual delta.

10. **Spec deltas are generated deterministically, not retyped.** The ~38 MODIFIED requirement bodies are produced by a script that parses each canonical spec into `### Requirement:` blocks, selects blocks containing a brand token, and applies the *same* ordered substitution map as the codemod — then emits them under `## MODIFIED Requirements`. Rationale: the risk in a MODIFIED delta is *silent transcription drift* in a long verbatim block (the documented "MODIFIED with partial content loses detail" pitfall), and that is the swap the codemod already performs correctly. Retyping the blocks by hand — or fanning them out to LLM agents to retype and "review" — points an ineffective tool at the failure mode: an LLM verifier misses transcription drift as readily as an LLM author introduces it. Deterministic substitution makes each delta block byte-identical to canonical except at the intended token boundaries *by construction*, and a residual grep (zero brand tokens, no whitelist applies inside specs) plus `openspec validate` plus a trial sync are the mechanical gate.

11. **Heading-embedded tokens use RENAMED + MODIFIED, not MODIFIED alone.** Three fs-sync-service requirements carry a brand token in the `### Requirement:` heading itself (`Data directory layout at $HOME/ft5/sync_app`, `ServiceConfigStore reads ~/ft5/sync_app/config.json …`, `Development builds may bypass authenticate via FT5_DEV_CREDENTIALS …`). OpenSpec's `applySpecs` matches a MODIFIED block by heading and applies operations in the order RENAMED → REMOVED → MODIFIED → ADDED, and explicitly requires that when a rename exists the MODIFIED block reference the *new* heading. So each of the three gets a `## RENAMED Requirements` FROM/TO pair (renaming the canonical heading) plus a MODIFIED block under the new heading. FROM/TO wrap the whole `### Requirement: …` in outer backticks so `parseRenames`' optional-trailing-backtick regex captures the heading's own trailing backtick (verified empirically by trial sync, not just by reading the regex).

12. **Purpose prose is updated by a direct edit, as a tracked exception.** Two capabilities carry brand tokens in their non-normative `## Purpose` prose (fs-sync-service: `ft5-cloude-sync`, `@ft5/fs-datasource-engine`, `$HOME/ft5/sync_app`, pipe `ft5-sync`, `sync.sock` dir; fs-datasource-engine: `@ft5/ipc-contracts`). OpenSpec's delta engine copies the pre-Requirements section (title + `## Purpose`) verbatim from the current canonical spec and ignores any preamble in the delta file — so **no delta operation can reach Purpose prose**. OpenSpec's own new-spec skeleton writes "Update Purpose after archive," confirming direct Purpose edits are sanctioned workflow (the "never modify `openspec/specs/` directly" Hard rule guards the *normative requirement contract*, which stays lifecycle-only). Leaving the residue would flatly contradict "retire Forti5 entirely," so the two Purpose sections are swapped by a direct edit committed with the spec-sync step, tracked as an explicit task and surfaced for human ratification at review because it brushes the Hard rule.

## Risks / Trade-offs

- **Over-match corruption** (a stray `ft5` → `cloudstash` mangling an unrelated token) → Mitigated by ordered most-specific-first rules (no bare-stem replace) + the guard's over-rename check + full suite on the renamed tree.
- **Codemod is not line-by-line reviewable** → Mitigated: the guard's four invariants + typecheck + unit + integration + e2e are the review surface; the method is ratified at human review before apply.
- **Lockstep divergence breaks runtime silently** (specs pass, app can't connect) → Mitigated by renaming each family in one commit and reinstalling the service. Families:
  - Pipe/socket: `services/fs-sync/src/env/paths.ts` (binds) == `apps/desktop/src/main/sync/pipe-paths.ts` (dials) == e2e smokes.
  - Data-dir `ft5` segment incl. `services/fs-sync/src/util/path-validator.ts` (a **security** path guard) == `FT5_SYNC_DATA_DIR`.
  - ESLint plugin key == rule id == ~46 disable pragmas (one commit or lint breaks).
  - Theme/motion store == cold-start bootstrap script (`theme-store.ts` == `theme-script.ts`; `motion-store.ts` == `motion-script.ts`) — divergence = FOUC on cold start.
  - Installer register == unregister per OS.
  - `productName` == 6 e2e packaged-path assertions + 3 README paths (Linux path is lowercase `cloudstash`).
- **better-sqlite3 ABI**: main-checkout full suite needs `pnpm abi:node` (electron vs node ABI). Fresh worktree needs `pnpm --filter @cloudstash/ipc-contracts build` (and, per prior experience, a full `pnpm typecheck`/`tsc -b`) before tests.
- **Renamed tree is NOT yet build/test-verified** — the codemod dry-run (≈1046 edits / 371 files) only confirms the tooling matches the recon inventory. The real validation (typecheck / build / unit / integration / e2e / `openspec validate`) happens after `--apply` in the worktree.
- **Signing certs not obtained** → release risk, not a code blocker; tracked for ops.
- **Whitelisted residue** (person email fixture, deprecated `FT5_GOOGLE_OAUTH_*` comments if left, `FT5 Sync Dev` dev display-name) → intentional; documented in the guard whitelist so it doesn't read as an incomplete rename. Note: none of these appear inside `openspec/specs/**`, so the spec-delta residual check runs with an *empty* whitelist and must reach exactly zero brand tokens.
- **Guard scope** → the guard's "openspec canary" (`git diff openspec/` empty) applies only to the **codemod step**, which must leave `openspec/**` untouched. It MUST NOT run against the spec-sync step or the Purpose direct-edit, both of which legitimately change `openspec/specs/**`.
- **Purpose direct-edit brushes a Hard rule** → mitigated by Decision 12 (sanctioned per OpenSpec's own skeleton) + explicit human ratification at review.

## Migration Plan

No data migration (pre-release). Deploy order within the apply worktree (staged, each stage green before the next):
1. Codemod stage — run `--apply`; `pnpm install` regenerates `pnpm-lock.yaml`; `pnpm -r build` + `pnpm typecheck` green.
2. Manual stage — add `productName: "CloudStash"` to `apps/desktop/package.json`; installer D1 edits (register/unregister per OS); `git mv` the logo component file; reinstall the service.
3. Spec deltas — authored in this change (deterministic generation, Decision 10); `openspec validate rebrand-to-cloudstash` before sync, `openspec validate <cap> --type spec` per capability after. Immediately around the sync, apply the two `## Purpose` direct edits (Decision 12) so the merged canonical specs carry no brand residue.
4. Verify — `rename-guard.sh` clean; full suite (`pnpm abi:node`) + e2e packaged-path smoke green.

Rollback: revert the branch (no persisted state depends on the new names pre-release).

## Open Questions

- None blocking. D1 (install-identity name) is decided as `cloudstash-sync`; D2–D7 (title-casing polish, deprecated OAuth env-var comments, email fixture, dev display-name, DB filename, appId/signing) are low-stakes and confirmed at review with the recommendations recorded in the change's decision notes.
