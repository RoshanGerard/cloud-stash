// wire-packaged-build-fs-sync-service §3 — how a packaged build spawns its
// service.
//
// The packaged app runs its OWN executable as a plain Node runtime rather than
// a separately vendored Node binary, and loads the service from inside the app
// bundle rather than from loose files beside it. Both were previously wrong in
// ways that produced no build error and no test failure — the paths simply did
// not exist at runtime, and every `sync:*` call rejected for the life of the
// process. These assertions are what make that regression loud.

import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveServiceSpawnTarget } from "./service-spawn-target.js";

const APP_PATH = path.join("C:", "app", "resources", "app.asar");

describe("resolveServiceSpawnTarget", () => {
  it("runs the app's own executable, not a vendored node binary", () => {
    const target = resolveServiceSpawnTarget({
      appPath: APP_PATH,
      execPath: path.join("C:", "app", "CloudStash.exe"),
      baseEnv: {},
    });

    expect(target.command).toBe(path.join("C:", "app", "CloudStash.exe"));
    // The retired resolver pointed at <resources>/node/<os>-<arch>/node.exe.
    // Nothing may reference that layout again.
    expect(target.command).not.toMatch(/[\\/]node[\\/]/);
  });

  it("loads the service from inside the app bundle", () => {
    const target = resolveServiceSpawnTarget({
      appPath: APP_PATH,
      execPath: "C:\\app\\CloudStash.exe",
      baseEnv: {},
    });

    expect(target.servicePath).toBe(path.join(APP_PATH, "dist", "service", "index.js"));
    // The old path escaped the bundle via `..`, landing in resources/ where
    // module resolution could never reach the app's node_modules.
    expect(target.servicePath).not.toMatch(/fs-sync/);
    expect(target.servicePath.startsWith(APP_PATH)).toBe(true);
  });

  it("sets ELECTRON_RUN_AS_NODE so the executable behaves as Node", () => {
    const target = resolveServiceSpawnTarget({
      appPath: APP_PATH,
      execPath: "C:\\app\\CloudStash.exe",
      baseEnv: {},
    });

    // Without this the spawned child boots a second Electron application
    // instead of the service.
    expect(target.env["ELECTRON_RUN_AS_NODE"]).toBe("1");
  });

  it("preserves the caller's environment alongside the runtime flag", () => {
    const target = resolveServiceSpawnTarget({
      appPath: APP_PATH,
      execPath: "C:\\app\\CloudStash.exe",
      baseEnv: { CLOUDSTASH_SYNC_DATA_DIR: "/tmp/data", PATH: "/usr/bin" },
    });

    // The service reads CLOUDSTASH_SYNC_DATA_DIR; dropping the inherited
    // environment would silently relocate the user's database.
    expect(target.env["CLOUDSTASH_SYNC_DATA_DIR"]).toBe("/tmp/data");
    expect(target.env["PATH"]).toBe("/usr/bin");
    expect(target.env["ELECTRON_RUN_AS_NODE"]).toBe("1");
  });

  it("does not mutate the environment it was given", () => {
    const baseEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    resolveServiceSpawnTarget({
      appPath: APP_PATH,
      execPath: "C:\\app\\CloudStash.exe",
      baseEnv,
    });

    // `process.env` is the real caller; writing ELECTRON_RUN_AS_NODE into it
    // would leak into every OTHER child this process spawns.
    expect(baseEnv["ELECTRON_RUN_AS_NODE"]).toBeUndefined();
  });
});
