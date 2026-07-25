// How a PACKAGED desktop build spawns the fs-sync service
// (wire-packaged-build-fs-sync-service, design.md Decisions 1–3).
//
// Replaces `node-binary-resolver.ts`, which resolved a vendored Node binary at
// `<resources>/node/<os>-<arch>/node.exe` that was never shipped, and paired it
// with a service at `<resources>/fs-sync/main/index.js` that was never shipped
// either. A packaged build therefore had no working sync at all: the supervisor
// exhausted its connect retries and every `sync:*` handler rejected for the
// lifetime of the process.
//
// Two things changed:
//
//   1. The command is the app's OWN executable, run as a plain Node runtime via
//      `ELECTRON_RUN_AS_NODE=1`. Electron's bundled Node matches the ABI of the
//      native modules the app already ships, so the service reuses them and
//      nothing extra is packaged. A standalone Node binary would run at a
//      different ABI and force a SECOND compiled copy of `better-sqlite3` into
//      the same installer.
//
//   2. The service lives INSIDE the app bundle. That is what makes its
//      dependencies resolvable: ordinary Node resolution from a path inside the
//      archive reaches the app's `node_modules`, while a loose file beside the
//      archive can never see into it.
//
// Pure and injectable, mirroring `pipe-paths.ts`: it takes `appPath`,
// `execPath` and the base environment rather than reading Electron or
// `process`, so the packaged branch is unit-testable without stubbing globals.
// It performs no filesystem check — the supervisor surfaces a missing target as
// a spawn failure, and keeping this pure keeps it trivially testable.

import * as path from "node:path";

export interface ResolveServiceSpawnTargetOptions {
  /** `app.getAppPath()` — points into `resources/app.asar` (or `resources/app`). */
  readonly appPath: string;
  /** `process.execPath` — the running application's own executable. */
  readonly execPath: string;
  /** Environment to derive the child's from, normally `process.env`. */
  readonly baseEnv: NodeJS.ProcessEnv;
}

export interface ServiceSpawnTarget {
  /** Executable to spawn. */
  readonly command: string;
  /** Absolute path to the service entry, inside the app bundle. */
  readonly servicePath: string;
  /** Environment for the child, including the Node-runtime flag. */
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Resolve everything the supervisor needs to spawn the service in a packaged
 * build. Production-only by construction: in dev the supervisor does not spawn
 * at all — `bin/dev.sh` owns the service — so there is no dev branch here.
 */
export function resolveServiceSpawnTarget(
  options: ResolveServiceSpawnTargetOptions,
): ServiceSpawnTarget {
  return {
    command: options.execPath,
    // Emitted by the desktop build as a second entry point (see
    // `electron.vite.config.ts`), so it sits beside `dist/main/index.js`
    // INSIDE the bundle rather than outside it.
    servicePath: path.join(options.appPath, "dist", "service", "index.js"),
    // Copy rather than mutate: `baseEnv` is `process.env` in production, and
    // writing the flag into it would leak into every other child this process
    // spawns.
    env: { ...options.baseEnv, ELECTRON_RUN_AS_NODE: "1" },
  };
}
