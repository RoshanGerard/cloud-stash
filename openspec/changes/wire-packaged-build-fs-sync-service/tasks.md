## 1. Supervisor accepts a spawn environment

- [x] 1.1 (test, watch it fail) In `apps/desktop/src/main/sync/supervisor.prod-spawn.test.ts` — the supervisor suite is split by branch across `supervisor.prod-spawn`, `supervisor.prod-connect`, `supervisor.dev-no-spawn`, and `supervisor.race`; the spawn branch is the one under change — assert that when `env` is supplied, `child_process.spawn` receives it in its options alongside the existing `detached: true, stdio: "ignore"`.
- [x] 1.2 (test) Assert the existing spawn behaviour is unchanged when `env` is omitted — no `env` key is added, so the child inherits `process.env` exactly as today.
- [x] 1.3 In `supervisor.ts`, add `readonly env?: NodeJS.ProcessEnv` to `StartSupervisorOptions` and forward it into the `spawn` options, documenting that the runtime choice belongs to the composition root (design.md Decision 4).
- [x] 1.4 Confirm the other three supervisor test files pass untouched — connect-first, the dev no-spawn branch, `unref()`, the retry schedule, the PID-guard race, and the never-signal-on-quit guarantee are all unchanged.

## 2. Build the service into the app bundle

- [ ] 2.1 In `apps/desktop/electron.vite.config.ts`, add a second rollup input to the `main` build whose source is the service's BUILT entry (`services/fs-sync/dist/main/index.js`), emitting `dist/service/index.js`. Keep `externalizeDepsPlugin` with the existing `exclude` semantics so `@cloudstash/*` are bundled while `better-sqlite3` / `drizzle-orm` stay external (design.md Decisions 2 and 3).
- [ ] 2.2 Add `pnpm --filter @cloudstash/fs-sync-service build` to the desktop package's `prebuild` (it already does this for `@cloudstash/ipc-contracts`) so the bundled service can never lag its sources.
- [ ] 2.3 Run `pnpm --filter @cloudstash/desktop build` and confirm `apps/desktop/dist/service/index.js` is emitted and non-trivial in size.
- [ ] 2.4 Verify the emitted bundle keeps `better-sqlite3` and `drizzle-orm` as external `require`s rather than inlining them — grep the output; a bundled native module would be a hard failure.

## 3. Point the supervisor at the bundled service

- [ ] 3.1 (test, watch it fail) In the main-process bootstrap test, assert the packaged branch resolves `servicePath` inside the app bundle (`<appPath>/dist/service/index.js`) and NOT at `<resources>/fs-sync/main/index.js`.
- [ ] 3.2 (test) Assert the packaged branch passes `process.execPath` as the spawn command and an env containing `ELECTRON_RUN_AS_NODE=1`.
- [ ] 3.3 In `apps/desktop/src/main/index.ts`, replace the `resolveServiceNodeBinary` call with `process.execPath`, resolve `servicePath` inside the app bundle, and pass `env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }`. Remove the now-unused import.
- [ ] 3.4 Confirm the dev branch is untouched — dev still supplies neither spawn path and still refuses to spawn.

## 4. Retire the dead node-binary resolver

- [ ] 4.1 Delete `apps/desktop/src/main/sync/node-binary-resolver.ts` and `node-binary-resolver.test.ts` (design.md Decision 5). No REMOVED spec delta is needed — no requirement in `openspec/specs/` references them.
- [ ] 4.2 Add a header to `node-binary-resolver.spike.md` recording that its bundled-Node plan was superseded, by which decision, and the deciding reason (a standalone Node runtime would force a second `better-sqlite3` compiled at a different ABI into the same installer). Keep the rest of the document as the rationale for the rejected alternative.
- [ ] 4.3 Confirm nothing else references the deleted module: grep for `resolveServiceNodeBinary` and `resources/node` across the repo.

## 5. Packaged-runtime smoke

- [ ] 5.1 Package for the current OS (`pnpm package:current-os`), then run `pnpm abi:node` afterwards — packaging flips `better-sqlite3` to the Electron ABI and breaks the vitest suite until it is flipped back.
- [ ] 5.2 Manually confirm the packaged app now starts its own service: launch it with a temp `CLOUDSTASH_SYNC_DATA_DIR` and verify the supervisor logs no "failed to start" error and that no `sync client not initialized` rejection appears.
- [ ] 5.3 Simplify `apps/desktop/e2e/leftover-status.spec.ts` into a true packaged smoke: delete the code that starts a service (the app now does it), and with it the spec's dependency on the workspace `better-sqlite3` ABI. Keep the seeding, the per-row disposition assertions, and the screenshot.
- [ ] 5.4 Re-measure `electron.launch` against the simplified spec and either revert to it or keep `connectOverCDP` — decide by measurement. Either way **correct the header comment**, which currently claims `electron.launch` hangs; it does not (3.9 s on Playwright 1.59.1, 8.6 s on 1.62.0, both measured 2026-07-25). Record what the original timeout actually was: the missing service left the leftover count at 0, so the button under test was correctly hidden (design.md Decision 7).
- [ ] 5.5 Confirm the smoke passes against the packaged build, and sanity-check it with a negative control (assert something impossible, confirm it fails and prints live DOM text) so a silently-skipping spec cannot read as green.

## 6. Cross-platform verification checklist

- [ ] 6.1 Write a manual verification checklist for macOS and Linux packaged builds, covering at minimum: that the notarized/signed `.app` can spawn `process.execPath` detached from within itself; that the spawned service survives quitting the app; that the native module loads at Electron's ABI; and that the Linux AppImage and deb both behave (design.md Decision 6).
- [ ] 6.2 Record in the checklist that a future Electron upgrade can skew the service's Node version away from `engines.node` — today both are 24.14.1 — and that the symptom would be a loud native-module ABI error at service start.
- [ ] 6.3 State plainly in the change's documentation that only Windows was verified automatically, so no cross-platform claim is implied by this change.

## 7. Verification and close-out

- [ ] 7.1 Full suite green: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`. If `better-sqlite3` fails to load, run `pnpm abi:node` first — and note that a running `bin/dev.sh` session holds the module at the Electron ABI and will make this impossible until it is stopped.
- [ ] 7.2 `openspec validate wire-packaged-build-fs-sync-service --strict` is green.
- [ ] 7.3 Confirm dev mode still works end to end: `./bin/dev.sh start`, app connects to the dev pipe, no spawn attempted.
- [ ] 7.4 Archive via `/opsx:archive` on the branch, then hand off through `finishing-a-development-branch`.
