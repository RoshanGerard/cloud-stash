import { chromium, expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// add-leftover-entry-status task 5.3 — GUI verification against a REAL running
// app rather than a jsdom render.
//
// The unit tests prove each layer in isolation; this proves the seams between
// them: a real SQLite database opened by the real fs-sync service, a real IPC
// hop over the named pipe, the real preload bridge, and the real React tree,
// ending at the text a user would actually read.
//
// The bug it pins: every leftover row used to read "Download failed", including
// files the user cancelled. A cancelled row records neither a `failure_tag` nor
// a `failure_message`, so the renderer had nothing to branch on until
// `LeftoverEntry.status` reached it.
//
// ---------------------------------------------------------------------------
// Running it
//
//   pnpm --filter @cloudstash/desktop package:win   # packaged build required
//   pnpm abi:node                                   # packaging flips
//                                                   # better-sqlite3 to the
//                                                   # Electron ABI; flip back
//                                                   # or seeding aborts
//   pnpm --filter @cloudstash/desktop exec playwright test e2e/leftover-status.spec.ts
//
// Not part of `pnpm test` (that is vitest, which does not include e2e/).
//
// ---------------------------------------------------------------------------
// Why this spec drives CDP directly instead of using `electron.launch`
//
// Playwright's Electron support does not work against this project's Electron
// version: `electron.launch()` completes its DevTools websocket handshake and
// then hangs until the test times out. The pre-existing `ping.spec.ts` fails
// the same way, so it is the harness, not this spec. Instead we spawn the
// packaged binary ourselves with a fixed `--remote-debugging-port` and attach
// with `chromium.connectOverCDP`, which drives the renderer as an ordinary
// Chromium page. If `electron.launch` starts working, this can be simplified.
//
// ---------------------------------------------------------------------------
// Why this spec starts the service itself
//
// The packaged app CANNOT start its own service today: `main/index.ts` expects
// electron-builder to have copied `services/fs-sync/dist` to
// `resources/fs-sync`, but `electron-builder.yml` declares `extraResources`
// only for the renderer. So the supervisor exhausts its 5 connect retries and
// every sync IPC handler rejects. That is a pre-existing packaging gap (see the
// `wire-packaged-build-download-resilience` stub, which notes packaged-build
// E2E was deferred), NOT something this change introduced. The supervisor is
// connect-first, so starting the service ourselves lets the app attach to it
// and exercises the identical IPC path.
//
// ---------------------------------------------------------------------------
// Isolation
//
// Both processes get `CLOUDSTASH_SYNC_DATA_DIR` pointed at a fresh temp dir, so
// the user's real `~/cloudstash/sync_app` is never read or written.
//
// CAVEAT — on Windows the named-pipe namespace is GLOBAL: `resolveSyncPipePath`
// returns a fixed `\\.\pipe\cloudstash-sync` and deliberately ignores the data
// dir. If a CloudStash service is already running, ours cannot bind and the app
// would read that service's database instead. The test asserts the pipe is free
// and skips loudly rather than silently verifying the wrong data.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEBUG_PORT = Number(process.env["CLOUDSTASH_E2E_CDP_PORT"] ?? 9333);

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

const SERVICE_ENTRY = path.join(REPO_ROOT, "services/fs-sync/dist/main/index.js");
const BETTER_SQLITE3 = path.join(
  REPO_ROOT,
  "node_modules/.pnpm/node_modules/better-sqlite3/lib/index.js",
);
const MIGRATIONS = path.join(REPO_ROOT, "services/fs-sync/dist/db/migrations.js");

/**
 * `FilesErrorTag`, loaded from the built LEAF module rather than imported from
 * the `@cloudstash/ipc-contracts` barrel.
 *
 * The barrel uses `export * as SyncService from ...`, and Playwright's babel
 * transform rejects that syntax ("Export namespace should be first transformed
 * by @babel/plugin-transform-export-namespace-from"), taking the whole spec
 * file down at collection time. The leaf has no namespace re-export.
 *
 * Loaded at all — rather than writing the string inline — because the repo's
 * `error-tag-const-convention` guard bans raw error-tag literals outside its
 * exemption list, and a seeded `failure_tag` should track the const anyway.
 */
async function filesErrorTags(): Promise<Record<string, string>> {
  const url = pathToFileURL(path.join(REPO_ROOT, "packages/ipc-contracts/dist/files.js")).href;
  const mod = (await import(url)) as { FilesErrorTag: Record<string, string> };
  return mod.FilesErrorTag;
}

/** The pipe/socket the service binds and the app dials. Mirrors `resolveSyncPipePath`. */
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

async function waitUntil(fn: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out after ${ms}ms waiting for ${label}`);
}

/**
 * Seed the database in a CHILD Node process.
 *
 * Out-of-process on purpose: the Playwright worker may hold a better-sqlite3
 * compiled for a different ABI, and a mismatched `require` aborts the whole
 * worker with an opaque crash. A child that exits keeps the failure legible.
 */
function seedDatabase(dataDir: string, partials: Record<string, string>, failedTag: string): void {
  const script = `
    const path = require("node:path");
    const Database = require(${JSON.stringify(BETTER_SQLITE3)});
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
  const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });
  if (!out.includes("seeded")) throw new Error(`seed failed: ${out}`);
}

test("leftover rows name their real terminal status, not 'Download failed'", async () => {
  test.setTimeout(180_000);

  const dataDir = mkdtempSync(path.join(tmpdir(), "cloudstash-e2e-"));
  const pipe = pipePath(dataDir);

  test.skip(
    await canConnect(pipe),
    `A CloudStash service already owns ${pipe}. On Windows that namespace is ` +
      `global, so ours cannot bind and the app would read the wrong database. ` +
      `Quit CloudStash and re-run.`,
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

  // `ELECTRON_RUN_AS_NODE` makes the Electron binary behave as a plain Node
  // runtime, which then rejects `--remote-debugging-port` with "bad option".
  // Tooling (electron-rebuild among others) leaves it set, so strip it rather
  // than trusting the inherited environment.
  const env = { ...process.env, CLOUDSTASH_SYNC_DATA_DIR: dataDir };
  delete env["ELECTRON_RUN_AS_NODE"];

  let service: ChildProcess | undefined;
  let app: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;

  try {
    service = spawn(process.execPath, [SERVICE_ENTRY], { env, stdio: "ignore" });
    await waitUntil(() => canConnect(pipe), 45_000, `the fs-sync service to bind ${pipe}`);

    app = spawn(exePath, [`--remote-debugging-port=${DEBUG_PORT}`], { env, stdio: "ignore" });
    await waitUntil(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok;
        } catch {
          return false;
        }
      },
      60_000,
      "the app's CDP endpoint",
    );

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    const context = browser.contexts()[0]!;
    const page: Page = context.pages()[0] ?? (await context.waitForEvent("page"));
    await page.waitForLoadState("domcontentloaded");

    // Settings → Downloads. The button is hidden at count 0, so its appearing
    // with (3) already proves the service found all three seeded rows and the
    // count crossed IPC.
    await page.getByRole("button", { name: "Open settings" }).click();
    const review = page.getByRole("button", { name: /review leftover files \(3\)/i });
    await expect(review).toBeVisible({ timeout: 30_000 });
    await review.click();

    await expect(page.getByRole("heading", { name: /leftover download files/i })).toBeVisible();

    const rows = page.getByRole("listitem");
    await expect(rows).toHaveCount(3);

    // THE BUG: this row must name itself cancelled and must not read as a
    // failure. Scoped per-row so the sibling failed row cannot satisfy it.
    const cancelled = rows.filter({ hasText: "movie.mkv.part" });
    await expect(cancelled).toContainText(/cancelled/i);
    await expect(cancelled).not.toContainText(/download failed/i);

    // ...and must be distinguishable from the interrupted row, which carries an
    // identical null tag and null message.
    const interrupted = rows.filter({ hasText: "archive.zip.part" });
    await expect(interrupted).toContainText(/interrupted/i);
    await expect(interrupted).not.toContainText(/cancelled/i);

    // A genuine failure still says so AND keeps its recorded detail.
    const failed = rows.filter({ hasText: "report.pdf.part" });
    await expect(failed).toContainText(/failed/i);
    await expect(failed).toContainText(/ran out of retries/i);

    // No row anywhere falls back to the old generic label.
    await expect(page.getByText(/download failed/i)).toHaveCount(0);

    // Collection-level copy describes the list across all three dispositions.
    await expect(page.getByText(/downloads that didn.t finish/i).first()).toBeVisible();

    await page.screenshot({
      path: path.join(__dirname, "__screenshots__", "leftover-status.png"),
    });
  } finally {
    await browser?.close();
    app?.kill();
    service?.kill();
  }
});
