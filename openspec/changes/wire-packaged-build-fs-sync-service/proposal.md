## Why

**A packaged CloudStash build has no working sync at all.** Every `sync:*` IPC
handler rejects for the lifetime of the process, so a user who installs the app
— rather than running it from source — gets a shell with no datasource
browsing, no jobs, and no downloads.

The desktop main process resolves the service at
`<resources>/fs-sync/main/index.js` and spawns it with a Node binary at
`<resources>/node/<os>-<arch>/node.exe`. **Neither path exists in the packaged
tree.** `electron-builder.yml` declares `extraResources` for the renderer only,
and no Node binary is vendored — there is no `vendor/` directory and no fetch
script. The supervisor therefore exhausts its five connect retries and
`getSyncClient()` throws `sync client not initialized` on every subsequent call.

Verified against a real `pnpm package:current-os` build on 2026-07-25:

```
supervisor: retry 1..5/5 to \\.\pipe\cloudstash-sync failed: connect ENOENT
[desktop] fs-sync supervisor failed to start — sync IPC handlers will reject
Error occurred in handler for 'sync:list-jobs': sync client not initialized
```

This is a known, chartered, never-filed gap. `wire-fs-sync-service`'s task 13.4
is checked `[ ]` and reads **"DEFERRED to follow-up change
`wire-packaged-build-fs-sync-service`"** — this change, named in three archived
design documents and never created. Its appendix records three compounding
causes: the service is not shipped, its dependencies would not resolve if it
were, and the spawn target is absent.

The gap survived because no requirement asserts that a packaged build can start
its service, and no test exercises a packaged artifact. Both are addressed here.

## What Changes

- Emit the service as a **second input to the existing `main` build**, landing
  at `dist/service/index.js` *inside* `app.asar`, using the same
  `externalizeDepsPlugin({ exclude: [...] })` machinery that already bundles
  `@cloudstash/fs-datasource-engine` into `dist/main/index.js`. Placing it
  inside the asar is what makes dependency resolution work: `drizzle-orm` and
  the workspace packages resolve normally, and `better-sqlite3` reaches its
  `app.asar.unpacked` copy through Electron's native-module redirect.
- Spawn the service with **`process.execPath` under `ELECTRON_RUN_AS_NODE=1`**
  instead of a vendored Node binary. The service then runs on Electron's
  bundled Node, whose ABI (145) matches the `better-sqlite3` the app already
  ships — so nothing extra is packaged and no second native build is needed.
  `detached: true` + `unref()` are unchanged, preserving the guarantee that the
  service outlives the desktop process.
- Extend `StartSupervisorOptions` with an optional `env` passed through to
  `child_process.spawn`, which is what carries `ELECTRON_RUN_AS_NODE`.
- **Remove** `node-binary-resolver.ts` and its test. They resolve a
  `<resources>/node/` path that this design guarantees will never exist. The
  spike document is kept and annotated with why its plan was superseded.
- Add a **packaged-runtime smoke test** — the first automated check that runs a
  real packaged artifact. `apps/desktop/e2e/leftover-status.spec.ts` becomes
  that smoke: once the app starts its own service, the spec stops starting one.
- Add a **manual verification checklist** for macOS and Linux, which cannot be
  automated from a Windows workstation.
- NOT breaking: no wire shape, IPC channel, renderer surface, or persisted
  format changes. Dev mode is untouched — `bin/dev.sh` still owns it.

## Capabilities

### New Capabilities

None. Both affected capabilities already exist.

### Modified Capabilities

- `fs-sync-supervisor`: MODIFY "Desktop supervisor connects-or-spawns the sync
  service". Clause 3 pins the spawn call verbatim as
  `spawn(nodeBinary, [servicePath], { detached: true, stdio: 'ignore' })`; the
  spawn target, the required environment, and the packaged service location all
  change, plus a scenario proving a packaged build starts its own service.
- `app-shell`: ADD a requirement that the packaged application contains a
  runnable service bundle the supervisor can spawn. The absence of exactly this
  requirement is why the defect shipped and stayed invisible.

## Impact

- `apps/desktop/electron.vite.config.ts` — second rollup input for the service;
  the desktop's `prebuild` gains `pnpm --filter @cloudstash/fs-sync-service
  build` so the bundled artifact is always current.
- `apps/desktop/src/main/sync/supervisor.ts` — `env` option threaded into
  `spawn`.
- `apps/desktop/src/main/index.ts` — `servicePath` resolves inside the app
  bundle; the `resolveServiceNodeBinary` call and import are removed.
- `apps/desktop/src/main/sync/node-binary-resolver.ts` + `.test.ts` — deleted.
  `node-binary-resolver.spike.md` — annotated as superseded.
- `apps/desktop/e2e/leftover-status.spec.ts` — simplified to a true packaged
  smoke; its incorrect claim that `electron.launch` hangs is corrected (it does
  not — measured at 3.9 s on Playwright 1.59.1 and 8.6 s on 1.62.0).
- New manual checklist document for macOS / Linux packaged verification.
- No dependency changes. No schema, migration, or config-format change.
- Installer size is unchanged — this ships no new binaries.
