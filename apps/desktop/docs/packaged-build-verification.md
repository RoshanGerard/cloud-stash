# Packaged-build verification checklist

Manual checks for the packaged desktop application, covering what the automated
smoke cannot.

**Automated coverage is Windows only.** `apps/desktop/e2e/leftover-status.spec.ts`
runs a real packaged artifact on Windows and asserts the app starts its own
fs-sync service. macOS and Linux have **no automated packaged coverage at all**
— nothing in CI or in `pnpm test` builds or launches a packaged app on those
platforms. Treat every macOS/Linux row below as unverified until a human runs it
and records the result.

Introduced by `wire-packaged-build-fs-sync-service`
(`openspec/changes/archive/*-wire-packaged-build-fs-sync-service/`), which fixed
a packaged build being unable to start its service at all. Read that change's
`design.md` before modifying anything here.

## Why this file exists

The defect it guards against is **silent**. A packaged app with a broken service
launches normally, renders its whole interface, and looks completely healthy —
only service-backed features fail, and they fail as rejected IPC calls the user
sees as empty lists. It shipped undetected because no requirement asserted a
packaged build could start its service and no test ran a packaged artifact.

If you change any of the following, re-run this checklist:

- `apps/desktop/electron.vite.config.ts` — especially the rollup inputs
- `apps/desktop/electron-builder.yml` — `files`, `extraResources`, `asarUnpack`
- `apps/desktop/src/main/sync/service-spawn-target.ts`
- `apps/desktop/src/main/sync/supervisor.ts` — the spawn branch
- `services/fs-sync/src/db/migrations.ts` — how migrations are located
- The Electron major version

## How the pieces fit

The packaged app spawns **its own executable** under `ELECTRON_RUN_AS_NODE=1`,
pointed at the service bundled inside `app.asar` at `dist/service/index.js`. It
does NOT ship a separate Node binary. Consequences worth holding in mind while
testing:

- The service runs on **Electron's** bundled Node, so its native-module ABI
  matches the app's. There is exactly one compiled `better-sqlite3` in the
  installer, shared by both.
- The service is spawned **detached** and **outlives the app on purpose**.
  Closing the app does not stop it. This is by design, not a leak.
- The service's SQL migrations ship as assets at the archive root (`<asar>/drizzle`),
  because `migrations.ts` finds them by walking two levels up from its own
  module. Bundling JavaScript does not carry data files.

## Checklist

### All platforms

- [ ] **The service is present in the bundle.** `<resources>/app.asar` contains
      `dist/service/index.js` and a `drizzle/` directory holding the `.sql`
      files. If `drizzle/` is missing, the service dies during `bootstrap()`
      with `ENOENT: scandir …drizzle` and never binds its pipe.
- [ ] **A cold launch starts the service.** With no service already running,
      launch the packaged app and confirm a second process appears running the
      app's own executable against `…app.asar/dist/service/index.js`.
- [ ] **Service-backed UI renders.** Any feature requiring service data works —
      the Windows smoke uses Settings → "Review leftover files", whose button is
      hidden at count 0 and therefore only appears if the whole path works.
- [ ] **No `sync client not initialized` errors** appear in the main process
      log. That message means the supervisor gave up and every `sync:*` handler
      is rejecting for the rest of the session.
- [ ] **The service survives app close** (this is correct behaviour). After
      quitting the app, the service process is still running and still listening.
- [ ] **A second launch adopts the running service** rather than spawning a
      duplicate — the supervisor is connect-first.

### macOS

- [ ] **A signed, notarized `.app` can spawn its own executable detached from
      within itself.** This is the least certain platform and the highest-value
      row here. Hardened runtime and Gatekeeper both sit between the app and a
      self-spawn; nothing in this repo has ever exercised it.
- [ ] The spawned service does **not** appear as a second Dock icon or a second
      app instance (`ELECTRON_RUN_AS_NODE` should prevent any UI).
- [ ] Quitting via Cmd-Q, and via the Dock, both leave the service running.
- [ ] Verify on **both** `arm64` and `x64` builds if you ship both.

### Linux

- [ ] Verify the **AppImage** and the **deb** separately — they differ in how
      the app directory is mounted, and the AppImage's mount point changes
      between runs, so anything that cached an absolute path will break there.
- [ ] Confirm the spawned service keeps running after the app exits, including
      when the AppImage's mount is torn down.

### Windows

Covered automatically by `e2e/leftover-status.spec.ts`. Run it after any
packaging change:

```
pnpm --filter @cloudstash/desktop package:win
pnpm --filter @cloudstash/desktop exec playwright test e2e/leftover-status.spec.ts
```

- [ ] Smoke passes.
- [ ] It passes **twice in a row**. The pipe name is global on Windows, so a
      service left over from the previous run gets adopted and the second run
      would read the first run's database while still appearing to pass.

## Known open questions

- **Does a packaged app exit cleanly for a real user while its service is
  running?** During e2e work, Playwright's `app.close()` stopped returning
  promptly once a service was connected. The app process does terminate — no
  orphaned main process was ever observed — so this looks like the close
  handshake rather than a leak, but **the mechanism was never established**. The
  smoke works around it by not awaiting `close()`. Worth confirming by hand:
  quit the app normally and check that no `CloudStash` main process lingers
  (the _service_ process legitimately remains).

## Electron upgrades

The service runs on Electron's bundled Node, so **an Electron upgrade changes
the service's runtime**. At the time of writing, Electron 41.2.1 ships Node
24.14.1, which is exactly the repo's pinned `engines.node` — zero skew.

After any Electron major bump:

- [ ] Compare Electron's bundled Node against `engines.node` in the root
      `package.json` and reconcile deliberately if they diverge.
- [ ] Re-run this checklist. A native-module ABI mismatch surfaces as a loud
      failure at service start (`NODE_MODULE_VERSION` mismatch), not as silent
      corruption — so the cold-launch row above will catch it.

## Local gotcha, not a packaging bug

Packaging runs `@electron/rebuild`, which flips the workspace's
`better-sqlite3` to the **Electron** ABI and breaks `pnpm test`. Run
`pnpm abi:node` afterwards. A running `bin/dev.sh` session does the same thing
and additionally file-locks the module, so `pnpm abi:node` returns `EBUSY` until
that session is stopped.

The Windows smoke is deliberately immune: it seeds through the packaged app's
own binary, so it does not touch the workspace copy at all.
