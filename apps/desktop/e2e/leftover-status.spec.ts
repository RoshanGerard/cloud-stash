import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import net from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// PACKAGED-RUNTIME SMOKE.
//
// The only automated check in this repo that runs a real packaged artifact. It
// launches the installed application, lets it start its OWN service, and
// asserts that a feature requiring service data renders correctly — proving the
// supervisor, the bundled service, its dependency resolution, its runtime
// assets, and the whole IPC path work together. Everything else is a unit test
// against one layer.
//
// It doubles as the regression test for two shipped defects:
//
//   1. `wire-packaged-build-fs-sync-service` — a packaged build could not start
//      its service at all, so every `sync:*` call rejected. That failure is
//      invisible to `pnpm test`, which never packages anything.
//   2. `add-leftover-entry-status` — every leftover row read "Download failed",
//      including files the user cancelled. A cancelled row records neither a
//      `failure_tag` nor a `failure_message`, so the renderer had nothing to
//      branch on until `LeftoverEntry.status` reached it.
//
// If this fails right after a packaging change, suspect (1): the app will still
// open and look completely healthy, and only service-backed features break.
//
// ---------------------------------------------------------------------------
// Running it
//
//   pnpm --filter @cloudstash/desktop package:win        # needs a packaged build
//   pnpm --filter @cloudstash/desktop exec playwright test e2e/leftover-status.spec.ts
//
// Not part of `pnpm test` (that is vitest, which does not collect e2e/).
//
// Note there is deliberately NO `pnpm abi:node` step. This spec does not touch
// the workspace's `better-sqlite3` at all — see "Seeding" below. Packaging does
// flip that module to the Electron ABI, so you still need `pnpm abi:node`
// before running the vitest suite; just not for this.
//
// ---------------------------------------------------------------------------
// Seeding
//
// The fixture rows are written by a short script run through the PACKAGED
// application's own binary under `ELECTRON_RUN_AS_NODE=1`, so it uses the
// `better-sqlite3` shipped inside the app. That is deliberate: the workspace
// copy gets flipped between the Node and Electron ABIs by packaging and by
// `bin/dev.sh`, and a spec that depended on which way it happens to be flipped
// would fail for reasons having nothing to do with the code under test.
// `applyMigrations` is pure JS and is imported from the service's build output.
//
// ---------------------------------------------------------------------------
// Isolation
//
// The app is launched with `CLOUDSTASH_SYNC_DATA_DIR` pointed at a fresh temp
// directory, and the supervisor spawns the service WITHOUT overriding env, so
// the child inherits it. The real `~/cloudstash/sync_app` is never touched.
//
// CAVEAT — on Windows the named-pipe namespace is GLOBAL: `resolveSyncPipePath`
// returns a fixed `\\.\pipe\cloudstash-sync` and deliberately ignores the data
// directory. The supervisor is connect-first, so an already-running service
// would be adopted and its database read instead of ours. The test asserts the
// pipe is free and skips loudly rather than silently verifying the wrong data.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const platformExe = {
  win32: "release/win-unpacked/CloudStash.exe",
  darwin: "release/mac/CloudStash.app/Contents/MacOS/CloudStash",
  linux: "release/linux-unpacked/cloudstash",
} as const;
const exePath = path.resolve(
  __dirname,
  "..",
  platformExe[process.platform as keyof typeof platformExe],
);

/** `better-sqlite3` as shipped inside the packaged app (Electron ABI). */
const PACKAGED_SQLITE = path.resolve(
  path.dirname(exePath),
  "resources/app.asar/node_modules/better-sqlite3",
);
const MIGRATIONS = path.join(REPO_ROOT, "services/fs-sync/dist/db/migrations.js");

/**
 * Kill the fs-sync service this test caused the app to spawn.
 *
 * The service is detached and survives the app on purpose, so nothing reaps it
 * for us. Identified by its command line — it runs the app's own executable
 * against the bundled service entry — so this never touches a `bin/dev.sh`
 * session (which runs the service from `services/fs-sync/dist` under the
 * node_modules Electron binary) or an app the developer opened themselves.
 */
async function killDetachedService(): Promise<void> {
  if (process.platform !== "win32") {
    // Unix sockets are per-data-dir, so a stray service cannot be adopted by
    // the next run the way a global Windows pipe can. Left as a no-op rather
    // than guessing at a pkill invocation that has never been exercised.
    return;
  }
  const psScript =
    "Get-CimInstance Win32_Process -Filter \"Name='CloudStash.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*app.asar*dist*service*index.js*' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", psScript], { stdio: "ignore" });
  } catch {
    // Best effort: a failure here must not mask the test's own result.
  }
}

/** The pipe the service binds and the app dials. Mirrors `resolveSyncPipePath`. */
function pipePath(dataDir: string): string {
  return process.platform === "win32"
    ? String.raw`\\.\pipe\cloudstash-sync`
    : path.join(dataDir, "sync.sock");
}

function canConnect(p: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(p);
    const done = (v: boolean): void => {
      s.destroy();
      resolve(v);
    };
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

/**
 * `FilesErrorTag`, loaded from the built LEAF module rather than imported from
 * the `@cloudstash/ipc-contracts` barrel.
 *
 * The barrel uses `export * as SyncService from ...`, and Playwright's babel
 * transform rejects that syntax ("Export namespace should be first transformed
 * by @babel/plugin-transform-export-namespace-from"), taking the whole spec
 * file down at collection time — reported unhelpfully as "No tests found".
 *
 * Loaded at all, rather than writing the string inline, because the repo's
 * `error-tag-const-convention` guard bans raw error-tag literals outside its
 * exemption list, and a seeded `failure_tag` should track the const anyway.
 */
async function filesErrorTags(): Promise<Record<string, string>> {
  const url = pathToFileURL(path.join(REPO_ROOT, "packages/ipc-contracts/dist/files.js")).href;
  const mod = (await import(url)) as { FilesErrorTag: Record<string, string> };
  return mod.FilesErrorTag;
}

/**
 * Seed the fixture rows using the PACKAGED app's binary as the runtime, so the
 * ABI always matches the `better-sqlite3` being loaded. Runs out-of-process:
 * a mismatched native module aborts the child rather than the Playwright
 * worker, which keeps the failure legible.
 */
function seedDatabase(dataDir: string, partials: Record<string, string>, failedTag: string): void {
  const script = `
    const path = require("node:path");
    const Database = require(${JSON.stringify(PACKAGED_SQLITE)});
    const { applyMigrations } = require(${JSON.stringify(MIGRATIONS)});
    const db = new Database(path.join(${JSON.stringify(dataDir)}, "sync.db"));
    applyMigrations(db);
    const ins = db.prepare(
      "INSERT INTO downloads (download_job_id, datasource_id, source_path, target_path," +
      " bytes_downloaded, content_length, status, failure_tag, failure_message," +
      " started_at, updated_at, ended_at)" +
      " VALUES (@id,'ds-e2e',@src,@target,100,NULL,@status,@tag,@msg,0,0,@endedAt)"
    );
    const r = ${JSON.stringify(partials)};
    const now = Date.now();
    // The cancelled and interrupted rows carry NULL tag AND NULL message — the
    // exact shape that used to render "Download failed".
    ins.run({ id: "e2e-cancelled", src: "/remote/movie.mkv", target: r.cancelled,
              status: "cancelled", tag: null, msg: null, endedAt: now - 2 * 3600000 });
    ins.run({ id: "e2e-interrupted", src: "/remote/archive.zip", target: r.interrupted,
              status: "interrupted", tag: null, msg: null, endedAt: now - 45 * 60000 });
    ins.run({ id: "e2e-failed", src: "/remote/report.pdf", target: r.failed,
              status: "failed", tag: ${JSON.stringify(failedTag)},
              msg: "ran out of retries",
              endedAt: now - 3 * 86400000 });
    db.close();
    console.log("seeded");
  `;
  const out = execFileSync(exePath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  if (!out.includes("seeded")) throw new Error(`seed failed: ${out}`);
}

test("a packaged build starts its own service and names each leftover's real status", async () => {
  test.setTimeout(180_000);

  const dataDir = mkdtempSync(path.join(tmpdir(), "cloudstash-e2e-"));
  const pipe = pipePath(dataDir);

  test.skip(
    await canConnect(pipe),
    `A CloudStash service already owns ${pipe}. On Windows that namespace is ` +
      `global, so the app would adopt it and read the wrong database. Quit ` +
      `CloudStash (and any bin/dev.sh session using the prod pipe) and re-run.`,
  );

  // Real partial files: the service stats each `target_path` and drops any row
  // whose file is missing, so these must genuinely exist on disk.
  const partials = {
    cancelled: path.join(dataDir, "movie.mkv.part"),
    interrupted: path.join(dataDir, "archive.zip.part"),
    failed: path.join(dataDir, "report.pdf.part"),
  };
  writeFileSync(partials.cancelled, "y".repeat(4096));
  writeFileSync(partials.interrupted, "z".repeat(512));
  writeFileSync(partials.failed, "x".repeat(1024));
  seedDatabase(dataDir, partials, (await filesErrorTags())["ExhaustedRetries"]!);

  // `ELECTRON_RUN_AS_NODE` must NOT be set for the app itself — it would make
  // the binary behave as a plain Node runtime and reject Playwright's launch
  // flags with "bad option". Tooling leaves it set in the ambient environment,
  // so strip it rather than trusting what we inherited. (The supervisor sets it
  // for the SERVICE child on its own; that is the whole point of the change.)
  const env = { ...process.env, CLOUDSTASH_SYNC_DATA_DIR: dataDir };
  delete env["ELECTRON_RUN_AS_NODE"];

  const app = await electron.launch({ executablePath: exePath, env });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Settings → Downloads. The button is HIDDEN at count 0, so its appearing
    // with (3) is itself the proof that the app started its own service, the
    // service opened the seeded database, and the count crossed IPC. Before
    // this change it never appeared, because every sync call rejected.
    await page.getByRole("button", { name: "Open settings" }).click();
    const review = page.getByRole("button", { name: /review leftover files \(3\)/i });
    await expect(review).toBeVisible({ timeout: 45_000 });
    await review.click();

    await expect(page.getByRole("heading", { name: /leftover download files/i })).toBeVisible();

    const rows = page.getByRole("listitem");
    await expect(rows).toHaveCount(3);

    // Each row must name its OWN disposition. Scoped per row so a sibling
    // cannot satisfy an assertion meant for another.
    const cancelled = rows.filter({ hasText: "movie.mkv.part" });
    await expect(cancelled).toContainText(/cancelled/i);
    await expect(cancelled).not.toContainText(/download failed/i);

    // Cancelled and interrupted carry identical null tag/message, so only
    // `status` can tell them apart.
    const interrupted = rows.filter({ hasText: "archive.zip.part" });
    await expect(interrupted).toContainText(/interrupted/i);
    await expect(interrupted).not.toContainText(/cancelled/i);

    // A genuine failure still says so AND keeps its recorded detail.
    const failed = rows.filter({ hasText: "report.pdf.part" });
    await expect(failed).toContainText(/failed/i);
    await expect(failed).toContainText(/ran out of retries/i);

    // No row anywhere falls back to the old generic label.
    await expect(page.getByText(/download failed/i)).toHaveCount(0);

    // Collection-level copy describes all three dispositions, not just failure.
    await expect(page.getByText(/downloads that didn.t finish/i).first()).toBeVisible();

    await page.screenshot({
      path: path.join(__dirname, "__screenshots__", "leftover-status.png"),
    });
  } finally {
    // Teardown is deliberately NOT `await app.close()`.
    //
    // Two things make that unsafe here, and both are consequences of the app
    // now genuinely running a service:
    //
    //   1. `app.close()` did not return promptly once a service was connected,
    //      hanging the test past its timeout. The app process does terminate —
    //      no orphaned main process is left behind — so this is about the close
    //      handshake, not a leaked app. The mechanism is NOT established; do
    //      not assume one from this comment.
    //   2. The service is spawned DETACHED and outlives the app by design. On
    //      Windows its pipe name is global, so a service left running from a
    //      previous run gets adopted by the next one via the supervisor's
    //      connect-first path — and that run then reads the PREVIOUS run's
    //      database while appearing to pass. This test would silently stop
    //      testing anything.
    //
    // So: end the app without waiting on the close handshake, then reap the
    // service this test caused to exist. Killing it is correct HERE (the test
    // owns it and seeded its data dir) even though the app must never do so.
    app.process().kill();
    await killDetachedService();
  }
});
