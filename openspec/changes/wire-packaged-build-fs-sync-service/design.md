## Context

The desktop app talks to a separate `fs-sync` service over a named pipe
(Windows) or Unix socket. The supervisor is **connect-first**: it dials the
pipe, and only if that fails does it spawn the service as a detached child that
deliberately outlives the desktop process.

In development this works because `bin/dev.sh` starts the service itself. In a
**packaged** build it has never worked. `main/index.ts` computes:

```ts
nodeBinary  = resolveServiceNodeBinary({ isPackaged: true, appPath: app.getAppPath() });
                                            // → <resources>/node/win-x64/node.exe
servicePath = path.join(app.getAppPath(), "..", "fs-sync", "main", "index.js");
                                            // → <resources>/fs-sync/main/index.js
```

Neither file is produced by the build. `electron-builder.yml`'s
`extraResources` lists only `src/renderer/out → renderer`, and no Node binary is
vendored anywhere in the repo. `resolveServiceNodeBinary` does not `stat` its
result (by deliberate design — the spike wanted it pure), so the failure only
surfaces later as a spawn ENOENT followed by five exhausted connect retries.

This was diagnosed and deferred once already. `wire-fs-sync-service` task 13.4
is unchecked and names this change as the owner; its design appendix lists three
compounding causes:

1. Service binary not shipped.
2. Service dependencies would not resolve if it were — pnpm's `.pnpm` store
   sits at the workspace root, outside electron-builder's file walker.
3. Spawn target missing; the appendix recommends pivoting to
   `ELECTRON_RUN_AS_NODE=1`.

Point 3 directly contradicts `node-binary-resolver.spike.md` §4 gotcha 4, which
had rejected `ELECTRON_RUN_AS_NODE` on three grounds: runtime-version coupling,
macOS detached-spawn complexity, and installer size. Resolving that
disagreement is the central decision below.

**Constraints:**

- The service MUST outlive the desktop app (`supervisor.ts` note 3: "The service
  outlives the desktop app by design"). This disqualifies
  `Electron.utilityProcess.fork()`, whose children die with the parent — the
  otherwise-idiomatic answer.
- `better-sqlite3` is native and can never be bundled; it must exist as a real
  file at an ABI matching whatever executes the service.
- Three signed targets ship: macOS dmg (signed + notarized), Windows nsis
  (signed), Linux AppImage/deb.
- Dev mode must keep working unchanged.

**Empirically verified against a real packaged build (2026-07-25), not assumed:**

| Check | Result |
| --- | --- |
| `ELECTRON_RUN_AS_NODE` can read inside `app.asar` | yes — listed `dist,node_modules,package.json` |
| `better-sqlite3` loads via the asar→unpacked redirect in that mode | yes — opened an in-memory DB |
| `drizzle-orm` resolves from inside the asar | yes |
| Electron 41.2.1's bundled Node vs the repo's `engines.node` | **both 24.14.1 — zero skew** |

## Goals / Non-Goals

**Goals:**

- A packaged build starts its own service and serves `sync:*` IPC.
- Ship no new binaries; installer size unchanged.
- Preserve the detached-lifetime guarantee exactly.
- Leave a requirement and an automated packaged-artifact test behind, so this
  class of defect cannot ship silently again.
- Leave dev mode untouched.

**Non-Goals:**

- Changing the wire protocol, IPC surface, or any renderer-facing shape.
- Changing dev-mode orchestration (`bin/dev.sh`) or the ABI-flip workflow.
- Single-instance enforcement — that is `add-service-instance-lock`.
- Auto-update, code-signing configuration, or CI runner changes.
- Cross-platform *automated* coverage; macOS and Linux get a manual checklist
  (Decision 6).

## Decisions

### Decision 1 — Spawn `process.execPath` under `ELECTRON_RUN_AS_NODE=1`

The supervisor spawns the app's own executable as a plain Node runtime rather
than a vendored Node binary.

*Why this settles the spike-vs-appendix disagreement.* The spike's three
objections were size, runtime-version coupling, and macOS detached spawn. The
decisive fact neither document noticed is that **the alternative requires
shipping `better-sqlite3` twice**: the app already bundles it at Electron's ABI
145, and a standalone Node binary would run at ABI 137, needing a second
compiled copy of the same native module in the same installer. That is a larger
correctness hazard than the concerns it was meant to avoid. On the spike's own
three points: size *improves* (0 MB added versus 50–90 MB); version coupling is
currently nil, since Electron 41's Node is 24.14.1, exactly the pinned
`engines.node`; and macOS detached spawn is a risk under either option, since
both spawn a binary from inside the signed bundle. It is also the trick
`bin/dev.sh` already uses in this repo, so the approach is proven here.

*Alternatives considered.* A vendored per-platform Node binary (the spike's
original plan) needs a `vendor/` tree, a fetch script, CI wiring, notarization
of a second executable, and the duplicate native module above — all absent
today. `utilityProcess.fork()` is the idiomatic Electron mechanism and would
give ABI matching for free, but its children are killed with the parent, which
breaks the service's defining property.

### Decision 2 — The service ships INSIDE `app.asar`, as a second `main` input

The service is emitted to `dist/service/index.js` by the existing
electron-vite `main` build, given a second rollup input.

*Why inside the asar.* This is what dissolves appendix cause 2. Node resolution
from a loose `<resources>/fs-sync/main/index.js` never walks into
`app.asar/node_modules`, so a service placed there cannot see `drizzle-orm` or
the engine no matter how it is built — which is why the appendix reached for
`pnpm deploy` or `node-linker=hoisted`. From *inside* the asar, ordinary
resolution applies and both were verified to load. Native modules are handled by
Electron's automatic `app.asar` → `app.asar.unpacked` redirect, which
`asarUnpack: ["**/*.node"]` already configures.

*Alternatives considered.* `extraResources` plus an esbuild single-file bundle
with `NODE_PATH` pointing back at the app's unpacked modules keeps the build
owned by `services/fs-sync`, but buys that separation with an explicit
resolution shim — a mechanism that exists only in production and therefore only
breaks in production. A repo-wide `node-linker=hoisted` would fix resolution
globally but changes dependency layout for every workspace to fix one packaging
path.

### Decision 3 — Bundle the service's BUILT output, not its TypeScript source

The rollup input is `services/fs-sync/dist/main/index.js`, and the desktop's
`prebuild` gains `pnpm --filter @cloudstash/fs-sync-service build`.

*Why.* Decision 2 makes the desktop build responsible for *packaging* the
service, which raises a fair objection: does the service stop being
framework-agnostic? Taking the built artifact keeps the answer no. The service
is still compiled by its own `tsconfig` under its own rules, and its source
still imports nothing from `apps/desktop`. The desktop build only bundles an
artifact that already exists. `prebuild` already does exactly this for
`@cloudstash/ipc-contracts`, so the ordering mechanism is established rather
than invented.

### Decision 4 — `env` becomes a supervisor option

`StartSupervisorOptions` gains an optional `env` forwarded to
`child_process.spawn`. It is the vehicle for `ELECTRON_RUN_AS_NODE=1`.

*Why an option rather than setting it inside the supervisor.* The supervisor is
a pure-ish unit with injected paths, and its tests assert the exact spawn
arguments. Passing `env` in keeps the "what runtime" decision at the composition
root (`main/index.ts`, which already knows `isPackaged`) and keeps the
supervisor testable without stubbing `process.env`.

### Decision 5 — Delete `node-binary-resolver`, keep and annotate the spike

`node-binary-resolver.ts` (55 lines) and its test (117 lines) are removed.
`node-binary-resolver.spike.md` stays, with a header recording that its plan was
superseded by Decision 1 and why.

*Why.* The module resolves a path this design guarantees will never exist, and
it is covered by tests that would keep passing — a module that is *verified* to
compute a dead path is worse than none, because it reads as intentional. It is
not referenced by any requirement in `openspec/specs/`, so removal needs no
REMOVED delta. The spike is kept because the rejected alternative and its
reasoning are exactly what a future reader re-litigating Decision 1 needs.

### Decision 6 — Windows is automated; macOS and Linux get a written checklist

The packaged smoke runs on Windows in this change. macOS and Linux get a
checklist covering notarization of the spawn target and detached spawn from
inside a `.app`.

*Why not claim more.* Only Windows can be built and run here. Wiring three-OS
packaged builds into CI is a build-infrastructure change of its own size, and
folding it in would either balloon this change or produce cross-platform claims
nothing verified. Stating the boundary is more useful than implying coverage.

### Decision 7 — The packaged smoke is the existing leftover e2e, corrected

`apps/desktop/e2e/leftover-status.spec.ts` becomes the packaged-runtime smoke.

*Why reuse it.* It already drives a packaged artifact end to end. Today it
compensates for this very defect by starting a service itself; once the app does
that, the compensation is deleted rather than duplicated in a second spec. That
also removes its dependency on the workspace `better-sqlite3` ABI, which
currently prevents it running at all while a dev session holds the module at ABI
145.

Its header comment must also be **corrected**: it states that
`electron.launch()` hangs against this project's Electron. That is wrong.
Measured 2026-07-25 under the Playwright test runner, `electron.launch`
succeeded in 3.9 s on Playwright 1.59.1 and 8.6 s on 1.62.0. The original
timeout was almost certainly this defect — with no service, `listLeftover`
rejects, the leftover count is 0, and the button under test is deliberately
hidden. Whether the spec keeps its CDP attach or reverts to `electron.launch` is
settled during implementation by measurement, not by the current comment.

## Risks / Trade-offs

- **Future Electron upgrades could skew the service's Node version.** Today
  there is none (both 24.14.1). Mitigated by the pinned `engines.node`, and by
  the fact that a skew surfaces as an immediate, loud native-module ABI error at
  service start rather than as silent corruption. Recorded in the checklist.
- **macOS detached spawn from inside a signed, notarized `.app` is the least
  certain platform.** It is unverifiable from this workstation, so it is
  explicitly the first item on the manual checklist rather than an assumed pass.
- **The desktop build now depends on the service's build output.** A stale
  `services/fs-sync/dist` would package a stale service. Mitigated by putting
  the build into `prebuild` so it cannot be skipped in the normal path.
- **The asar is read-only.** The service writes only to its data directory
  (`CLOUDSTASH_SYNC_DATA_DIR` or the home-relative default), never beside its
  own entry point, so this is a non-issue — noted because it is the obvious
  question about running code from inside an archive.
- **Reusing the leftover e2e couples one feature's test to packaging health.** A
  packaging regression will now fail a test named for leftover files. Accepted:
  one real packaged smoke is worth more than a second near-duplicate spec, and
  the failure mode is loud either way.
