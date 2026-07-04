// Unit tests for the in-memory `DownloadRegistry` that backs the
// fs-sync service's DOWNLOAD-side state. See:
//
// - openspec/changes/add-engine-rename-download/design.md "Decision 4"
//   (in-memory only, lives in the service handler not the engine).
// - openspec/changes/add-engine-rename-download/specs/fs-sync-service/spec.md
//   "Requirement: In-memory `DownloadRegistry` tracks active downloads".
//
// Shape recap (service-internal, carries `abortController`; the IPC-exposed
// `DownloadJob` from `@cloudstash/ipc-contracts` strips it):
//
//   interface DownloadJobEntry {
//     downloadJobId: string;          // service-minted UUID
//     datasourceId: string;
//     sourcePath: string;
//     targetPath: string;
//     bytesDownloaded: number;
//     contentLength: number | null;
//     startedAt: number;              // ms epoch
//     abortController: AbortController;
//   }
//
// API: set / update / finalize / get / snapshot. See registry.ts
// for full rationale on the type-narrow `update` partial and the
// replace-don't-mutate strategy.
//
// Durable mirror (migrate-download-registry-to-sqlite). The registry now
// accepts an optional `db` handle and write-through-mirrors the download
// lifecycle into the `downloads` table while the in-memory Map stays
// authoritative for live state. Most tests below construct an in-memory
// `:memory:` db via `makeRegistry()` and assert the memory contract is
// unchanged; the DB-inspecting tests additionally query `downloads` to pin
// the mirror behavior (set → in-flight row, throttled progress writes,
// finalize → terminal row + memory cleanup).

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyMigrations } from "../../db/migrations.js";
import {
  createDownloadRegistry,
  type DownloadFinalizeOutcome,
  type DownloadJobEntry,
  type DownloadJobUpdate,
  type DownloadRegistry,
} from "../registry.js";

/**
 * Spins up a fresh in-memory SQLite db with the full schema applied and a
 * registry wired to it. Returns both so DB-inspecting tests can query the
 * `downloads` table directly. Memory-only tests destructure just `registry`.
 */
function makeRegistry(): { registry: DownloadRegistry; db: Database.Database } {
  const db = new Database(":memory:");
  applyMigrations(db);
  return { registry: createDownloadRegistry(db), db };
}

/** Row shape of the `downloads` table (snake_case as stored). */
interface DownloadRow {
  download_job_id: string;
  datasource_id: string;
  source_path: string;
  target_path: string;
  bytes_downloaded: number;
  content_length: number | null;
  status: string;
  failure_tag: string | null;
  failure_message: string | null;
  started_at: number;
  updated_at: number;
  ended_at: number | null;
}

function readRow(db: Database.Database, id: string): DownloadRow | undefined {
  return db
    .prepare("SELECT * FROM downloads WHERE download_job_id = ?")
    .get(id) as DownloadRow | undefined;
}

function makeEntry(
  overrides: Partial<DownloadJobEntry> = {},
): DownloadJobEntry {
  return {
    downloadJobId: "job-A",
    datasourceId: "ds-1",
    sourcePath: "/welcome.pdf",
    targetPath: "/downloads/welcome.pdf",
    bytesDownloaded: 0,
    contentLength: 1_048_576,
    startedAt: 1_000,
    abortController: new AbortController(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DownloadRegistry", () => {
  describe("set / get", () => {
    it("set adds an entry keyed by downloadJobId, retrievable via get", () => {
      const { registry } = makeRegistry();
      const entry = makeEntry();
      registry.set(entry);
      const got = registry.get("job-A");
      expect(got).toBeDefined();
      expect(got?.downloadJobId).toBe("job-A");
      expect(got?.datasourceId).toBe("ds-1");
      expect(got?.sourcePath).toBe("/welcome.pdf");
      expect(got?.targetPath).toBe("/downloads/welcome.pdf");
      expect(got?.bytesDownloaded).toBe(0);
      expect(got?.contentLength).toBe(1_048_576);
      expect(got?.startedAt).toBe(1_000);
      // The abortController is the SAME reference — must not be cloned, the
      // handler aborts cancels through it.
      expect(got?.abortController).toBe(entry.abortController);
    });

    it("get for an unknown downloadJobId returns undefined, never throws", () => {
      const { registry } = makeRegistry();
      expect(() => registry.get("nope")).not.toThrow();
      expect(registry.get("nope")).toBeUndefined();
    });

    it("set with the same downloadJobId twice replaces the entry (last write wins)", () => {
      const { registry } = makeRegistry();
      const first = makeEntry({ bytesDownloaded: 100 });
      const second = makeEntry({ bytesDownloaded: 200 });
      registry.set(first);
      registry.set(second);
      expect(registry.get("job-A")?.bytesDownloaded).toBe(200);
      // The replacement uses the second entry's abortController.
      expect(registry.get("job-A")?.abortController).toBe(second.abortController);
    });

    it("size reflects the number of entries", () => {
      const { registry } = makeRegistry();
      expect(registry.size()).toBe(0);
      registry.set(makeEntry({ downloadJobId: "job-A", startedAt: 1_000 }));
      registry.set(makeEntry({ downloadJobId: "job-B", startedAt: 2_000 }));
      expect(registry.size()).toBe(2);
    });
  });

  describe("update", () => {
    it("update merges the partial into the existing entry", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ bytesDownloaded: 0, contentLength: null }));
      registry.update("job-A", {
        bytesDownloaded: 524_288,
        contentLength: 1_048_576,
      });
      const got = registry.get("job-A");
      expect(got?.bytesDownloaded).toBe(524_288);
      expect(got?.contentLength).toBe(1_048_576);
      // Identity fields untouched.
      expect(got?.downloadJobId).toBe("job-A");
      expect(got?.datasourceId).toBe("ds-1");
      expect(got?.sourcePath).toBe("/welcome.pdf");
      expect(got?.targetPath).toBe("/downloads/welcome.pdf");
      expect(got?.startedAt).toBe(1_000);
    });

    it("update merges partial fields independently (only one of {bytesDownloaded, contentLength})", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ bytesDownloaded: 100, contentLength: 1_000 }));
      registry.update("job-A", { bytesDownloaded: 250 });
      expect(registry.get("job-A")?.bytesDownloaded).toBe(250);
      // contentLength untouched.
      expect(registry.get("job-A")?.contentLength).toBe(1_000);
    });

    it("update preserves the abortController reference (no cloning)", () => {
      const { registry } = makeRegistry();
      const entry = makeEntry();
      registry.set(entry);
      registry.update("job-A", { bytesDownloaded: 42 });
      expect(registry.get("job-A")?.abortController).toBe(entry.abortController);
    });

    it("update on a missing downloadJobId is a silent no-op (no throw, registry unchanged)", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry());
      expect(() =>
        registry.update("does-not-exist", { bytesDownloaded: 1 }),
      ).not.toThrow();
      // Existing entry untouched.
      expect(registry.get("job-A")?.bytesDownloaded).toBe(0);
      expect(registry.size()).toBe(1);
    });

    it("update produces a fresh entry object (replace-don't-mutate)", () => {
      // This guards the "snapshot is a stable copy" property — if `update`
      // mutated the entry in place, a snapshot taken before the update would
      // see post-update values, breaking consumers.
      const { registry } = makeRegistry();
      registry.set(makeEntry({ bytesDownloaded: 0 }));
      const before = registry.get("job-A");
      registry.update("job-A", { bytesDownloaded: 999 });
      const after = registry.get("job-A");
      expect(before?.bytesDownloaded).toBe(0); // pre-update reference unchanged
      expect(after?.bytesDownloaded).toBe(999);
      expect(before).not.toBe(after);
    });
  });

  describe("finalize (memory removal)", () => {
    it("finalize removes the entry; subsequent get returns undefined", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry());
      registry.finalize("job-A", { status: "completed" });
      expect(registry.get("job-A")).toBeUndefined();
      expect(registry.size()).toBe(0);
    });

    it("finalize on a missing downloadJobId is a silent no-op (no throw)", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      expect(() =>
        registry.finalize("does-not-exist", { status: "completed" }),
      ).not.toThrow();
      expect(registry.size()).toBe(1);
      expect(registry.get("job-A")).toBeDefined();
    });

    it("finalize then snapshot omits the entry", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A", startedAt: 1_000 }));
      registry.set(makeEntry({ downloadJobId: "job-B", startedAt: 2_000 }));
      registry.finalize("job-A", { status: "completed" });
      const snap = registry.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]?.downloadJobId).toBe("job-B");
    });
  });

  describe("snapshot", () => {
    it("snapshot returns [] for an empty registry", () => {
      const { registry } = makeRegistry();
      expect(registry.snapshot()).toEqual([]);
    });

    it("snapshot returns entries ordered by startedAt ascending (oldest first)", () => {
      const { registry } = makeRegistry();
      // Insert in non-startedAt order to prove the sort happens.
      registry.set(makeEntry({ downloadJobId: "job-C", startedAt: 3_000 }));
      registry.set(makeEntry({ downloadJobId: "job-A", startedAt: 1_000 }));
      registry.set(makeEntry({ downloadJobId: "job-B", startedAt: 2_000 }));
      const ids = registry.snapshot().map((e) => e.downloadJobId);
      expect(ids).toEqual(["job-A", "job-B", "job-C"]);
    });

    it("snapshot is a stable copy: mutating the returned array does not mutate the registry", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A", startedAt: 1_000 }));
      registry.set(makeEntry({ downloadJobId: "job-B", startedAt: 2_000 }));
      const snap = registry.snapshot();
      // Push and splice on the returned array — the registry must be unaffected.
      snap.push(makeEntry({ downloadJobId: "phantom", startedAt: 9_999 }));
      snap.splice(0, 1);
      const snap2 = registry.snapshot();
      expect(snap2).toHaveLength(2);
      expect(snap2.map((e) => e.downloadJobId).sort()).toEqual(["job-A", "job-B"]);
    });

    it("snapshot taken before an update is unaffected by the update (replace-don't-mutate)", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ bytesDownloaded: 0 }));
      const snap = registry.snapshot();
      registry.update("job-A", { bytesDownloaded: 500 });
      // The pre-update snapshot still reflects the pre-update state.
      expect(snap[0]?.bytesDownloaded).toBe(0);
      // A fresh snapshot reflects the new state.
      expect(registry.snapshot()[0]?.bytesDownloaded).toBe(500);
    });
  });

  describe("concurrency safety", () => {
    it("100 rapid update calls all land before a final snapshot reflects all of them", () => {
      // JavaScript is single-threaded, so map mutations are atomic at the
      // call boundary; the property under test is that the registry's API
      // does NOT read-modify-write across awaits in a way that races. The
      // implementation is fully synchronous; this test pins that contract.
      const { registry } = makeRegistry();
      registry.set(makeEntry({ bytesDownloaded: 0 }));
      for (let i = 1; i <= 100; i++) {
        registry.update("job-A", { bytesDownloaded: i });
      }
      expect(registry.snapshot()[0]?.bytesDownloaded).toBe(100);
      expect(registry.get("job-A")?.bytesDownloaded).toBe(100);
    });

    it("interleaved set / update / finalize preserves last-writer-wins semantics", () => {
      const { registry } = makeRegistry();
      const a1 = makeEntry({ downloadJobId: "job-A", startedAt: 1_000 });
      const b1 = makeEntry({ downloadJobId: "job-B", startedAt: 2_000 });
      registry.set(a1);
      registry.set(b1);
      registry.update("job-A", { bytesDownloaded: 10 });
      registry.update("job-B", { bytesDownloaded: 20 });
      registry.finalize("job-A", { status: "completed" });
      registry.update("job-B", { bytesDownloaded: 30 });
      const snap = registry.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]?.downloadJobId).toBe("job-B");
      expect(snap[0]?.bytesDownloaded).toBe(30);
    });
  });

  // §11.3 — Tiny lifecycle integration test: registry transitions match the
  // design when fed a fake engine event sequence. The registry doesn't
  // subscribe to the engine bus (that's §13.21-§13.26); this test simulates
  // the lifecycle by manually calling set / update / finalize in the order the
  // §13 handler drives (start → progress → terminal).
  describe("lifecycle integration (§11.3)", () => {
    it("start → multiple progress updates → terminal success removes the entry", () => {
      const { registry } = makeRegistry();

      // 1. `set` on download start (the §13 handler mints downloadJobId and
      //    registers an entry with bytesDownloaded: 0).
      const abortController = new AbortController();
      registry.set({
        downloadJobId: "job-lifecycle",
        datasourceId: "ds-1",
        sourcePath: "/welcome.pdf",
        targetPath: "/downloads/welcome.pdf",
        bytesDownloaded: 0,
        contentLength: 1_048_576,
        startedAt: 5_000,
        abortController,
      });
      expect(registry.get("job-lifecycle")?.bytesDownloaded).toBe(0);

      // 2. Multiple `update` calls (driven by engine bus `downloading` event
      //    simulation, increment bytesDownloaded toward contentLength).
      const fakeBusEvents: ReadonlyArray<{ loaded: number; total: number }> = [
        { loaded: 262_144, total: 1_048_576 },
        { loaded: 524_288, total: 1_048_576 },
        { loaded: 786_432, total: 1_048_576 },
        { loaded: 1_048_576, total: 1_048_576 },
      ];
      for (const evt of fakeBusEvents) {
        registry.update("job-lifecycle", {
          bytesDownloaded: evt.loaded,
          contentLength: evt.total,
        });
      }
      expect(registry.get("job-lifecycle")?.bytesDownloaded).toBe(1_048_576);
      expect(registry.get("job-lifecycle")?.contentLength).toBe(1_048_576);

      // Snapshot mid-lifecycle reflects current bytes.
      expect(registry.snapshot()).toHaveLength(1);
      expect(registry.snapshot()[0]?.bytesDownloaded).toBe(1_048_576);

      // 3. Terminal `finalize` (driven by the handler's success path).
      registry.finalize("job-lifecycle", { status: "completed" });
      expect(registry.get("job-lifecycle")).toBeUndefined();
      expect(registry.snapshot()).toEqual([]);
    });

    it("start → progress → terminal cancel removes the entry", () => {
      const { registry } = makeRegistry();
      registry.set({
        downloadJobId: "job-cancel",
        datasourceId: "ds-1",
        sourcePath: "/big.iso",
        targetPath: "/downloads/big.iso",
        bytesDownloaded: 0,
        contentLength: null, // provider didn't advertise length
        startedAt: 6_000,
        abortController: new AbortController(),
      });
      registry.update("job-cancel", { bytesDownloaded: 1_000 });
      registry.update("job-cancel", { bytesDownloaded: 5_000 });
      // Handler cancel path → registry finalize with status 'cancelled'.
      registry.finalize("job-cancel", { status: "cancelled" });
      expect(registry.get("job-cancel")).toBeUndefined();
    });

    it("start → terminal failure removes the entry without intervening progress", () => {
      const { registry } = makeRegistry();
      registry.set({
        downloadJobId: "job-fail",
        datasourceId: "ds-1",
        sourcePath: "/missing.pdf",
        targetPath: "/downloads/missing.pdf",
        bytesDownloaded: 0,
        contentLength: null,
        startedAt: 7_000,
        abortController: new AbortController(),
      });
      // Handler terminal-failure path → emits terminal and calls
      // registry.finalize with status 'failed' (no retry path here).
      registry.finalize("job-fail", {
        status: "failed",
        failureTag: "other",
        failureMessage: "download failed",
      });
      expect(registry.snapshot()).toEqual([]);
    });
  });

  // Surface check: type-level guard that the partial accepted by `update`
  // excludes the immutable identity fields. We use a local helper typed as
  // `DownloadJobUpdate` and verify at compile time that identity fields are
  // not assignable. This is a runtime no-op; the value comes from the
  // `pnpm typecheck` pass.
  describe("type-level guards", () => {
    it("DownloadJobUpdate accepts mutable fields and rejects identity fields", () => {
      const ok: DownloadJobUpdate = { bytesDownloaded: 1 };
      const ok2: DownloadJobUpdate = { contentLength: null };
      const ok3: DownloadJobUpdate = { bytesDownloaded: 1, contentLength: 2 };
      expect(ok).toBeDefined();
      expect(ok2).toBeDefined();
      expect(ok3).toBeDefined();

      // The following would fail typecheck (uncomment to verify locally):
      //   const bad: DownloadJobUpdate = { downloadJobId: "x" };
      //   const bad2: DownloadJobUpdate = { datasourceId: "x" };
      //   const bad3: DownloadJobUpdate = { sourcePath: "x" };
      //   const bad4: DownloadJobUpdate = { targetPath: "x" };
      //   const bad5: DownloadJobUpdate = { startedAt: 0 };
      //   const bad6: DownloadJobUpdate = { abortController: new AbortController() };
    });
  });

  // Reverse-index lookup (per add-engine-rename-download §13.23 + spec.md
  // "Service subscribes to engine bus events"). The handler's
  // concurrent-rejection guard reads `(datasourceId, sourcePath) →
  // downloadJobId` BEFORE any engine call; the engine-bus subscription
  // callback uses it to correlate engine events back to the in-flight
  // job's `downloadJobId`. Identity fields are immutable per the §11
  // entry contract, so the reverse index is set on `set` and cleared on
  // `finalize` — `update` must NOT touch it.
  describe("findByKey reverse index (§13.23)", () => {
    it("returns the downloadJobId for an in-flight (datasourceId, sourcePath) pair", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      expect(registry.findByKey("ds-1", "/welcome.pdf")).toBe("job-A");
    });

    it("returns undefined for an unknown (datasourceId, sourcePath) pair", () => {
      const { registry } = makeRegistry();
      expect(registry.findByKey("ds-ghost", "/unknown.pdf")).toBeUndefined();
    });

    it("clears the mapping after finalize so a fresh download can re-claim the key", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      registry.finalize("job-A", { status: "completed" });
      expect(registry.findByKey("ds-1", "/welcome.pdf")).toBeUndefined();
      // A fresh entry on the same (datasourceId, sourcePath) is now allowed.
      registry.set(
        makeEntry({ downloadJobId: "job-B", startedAt: 2_000 }),
      );
      expect(registry.findByKey("ds-1", "/welcome.pdf")).toBe("job-B");
    });

    it("is unaffected by update — identity fields are immutable per the §11 contract", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      registry.update("job-A", { bytesDownloaded: 524_288, contentLength: 1_048_576 });
      // The reverse index still resolves to "job-A" — `update` only mutates
      // bytesDownloaded / contentLength.
      expect(registry.findByKey("ds-1", "/welcome.pdf")).toBe("job-A");
    });

    it("distinct (datasourceId, sourcePath) pairs each map to their own downloadJobId", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      registry.set(
        makeEntry({
          downloadJobId: "job-B",
          datasourceId: "ds-2",
          sourcePath: "/other.pdf",
          startedAt: 2_000,
        }),
      );
      expect(registry.findByKey("ds-1", "/welcome.pdf")).toBe("job-A");
      expect(registry.findByKey("ds-2", "/other.pdf")).toBe("job-B");
    });

    it("finalize is a no-op on an unknown id and does not corrupt the reverse index", () => {
      const { registry } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      registry.finalize("nope", { status: "completed" });
      expect(registry.findByKey("ds-1", "/welcome.pdf")).toBe("job-A");
    });
  });

  // ---------------------------------------------------------------------------
  // SQLite write-through mirror (migrate-download-registry-to-sqlite).
  // The in-memory Map stays authoritative; the registry is the single writer
  // to the `downloads` table. These blocks query the table directly to pin the
  // mirror behavior. `set` → in-flight row; `update` → throttled progress
  // writes; `finalize` → forced terminal row + memory cleanup (the sole
  // terminal-status writer and the only memory-removal path).
  // ---------------------------------------------------------------------------

  describe("db mirror — set inserts an in-flight row", () => {
    it("set inserts a row with status='in-flight', bytes_downloaded=0, started_at set, ended_at NULL", () => {
      const { registry, db } = makeRegistry();
      registry.set(
        makeEntry({
          downloadJobId: "job-A",
          datasourceId: "ds-1",
          sourcePath: "/welcome.pdf",
          targetPath: "/downloads/welcome.pdf",
          contentLength: 1_048_576,
          startedAt: 4_242,
        }),
      );

      const row = readRow(db, "job-A");
      expect(row).toBeDefined();
      expect(row?.download_job_id).toBe("job-A");
      expect(row?.datasource_id).toBe("ds-1");
      expect(row?.source_path).toBe("/welcome.pdf");
      expect(row?.target_path).toBe("/downloads/welcome.pdf");
      expect(row?.bytes_downloaded).toBe(0);
      expect(row?.content_length).toBe(1_048_576);
      expect(row?.status).toBe("in-flight");
      expect(row?.failure_tag).toBeNull();
      expect(row?.failure_message).toBeNull();
      expect(row?.started_at).toBe(4_242);
      expect(row?.updated_at).toBe(4_242);
      expect(row?.ended_at).toBeNull();
    });

    it("set persists a NULL content_length when the provider didn't advertise length", () => {
      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A", contentLength: null }));
      expect(readRow(db, "job-A")?.content_length).toBeNull();
    });

    it("set with the same id twice resets the row to in-flight (last-writer-wins)", () => {
      const { registry, db } = makeRegistry();
      // First job runs, progresses, and is finalized as failed.
      registry.set(makeEntry({ downloadJobId: "job-A", startedAt: 1_000 }));
      registry.finalize("job-A", {
        status: "failed",
        failureTag: "provider-error",
        bytesDownloaded: 500,
      });
      expect(readRow(db, "job-A")?.status).toBe("failed");

      // A fresh download mints the same id (contract tolerates it). The row
      // must reset to a clean in-flight state — no stale failure metadata.
      registry.set(makeEntry({ downloadJobId: "job-A", startedAt: 2_000 }));
      const row = readRow(db, "job-A");
      expect(row?.status).toBe("in-flight");
      expect(row?.bytes_downloaded).toBe(0);
      expect(row?.failure_tag).toBeNull();
      expect(row?.failure_message).toBeNull();
      expect(row?.ended_at).toBeNull();
      expect(row?.started_at).toBe(2_000);
    });

    it("set mirrors to the db while memory get/snapshot/findByKey/size still behave as before", () => {
      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A", startedAt: 1_000 }));
      registry.set(
        makeEntry({
          downloadJobId: "job-B",
          datasourceId: "ds-2",
          sourcePath: "/other.pdf",
          startedAt: 2_000,
        }),
      );

      // Memory contract unchanged.
      expect(registry.get("job-A")?.downloadJobId).toBe("job-A");
      expect(registry.size()).toBe(2);
      expect(registry.snapshot().map((e) => e.downloadJobId)).toEqual([
        "job-A",
        "job-B",
      ]);
      expect(registry.findByKey("ds-2", "/other.pdf")).toBe("job-B");

      // Both rows mirrored.
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM downloads")
        .get() as { n: number };
      expect(count.n).toBe(2);
    });
  });

  describe("db mirror — update throttles progress writes (10 MB OR 30 s)", () => {
    const TEN_MB = 10 * 1024 * 1024;

    it("sub-10MB updates < 30s apart rewrite memory every time but only flush to the db at the 10MB boundary", () => {
      vi.useFakeTimers();
      const base = 1_700_000_000_000;
      vi.setSystemTime(base);

      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A", contentLength: null }));
      // Row seeded at 0 by `set`.
      expect(readRow(db, "job-A")?.bytes_downloaded).toBe(0);

      // Several sub-threshold ticks, each < 30s apart. Memory updates every
      // time; the db row must NOT advance (delta < 10 MB, elapsed < 30 s).
      const subThreshold = [1_000_000, 2_000_000, 5_000_000, 9_000_000];
      for (const bytes of subThreshold) {
        vi.setSystemTime(base + 1_000); // advance 1s — well under 30s
        registry.update("job-A", { bytesDownloaded: bytes });
        expect(registry.get("job-A")?.bytesDownloaded).toBe(bytes); // memory always
        expect(readRow(db, "job-A")?.bytes_downloaded).toBe(0); // db throttled
      }

      // Crossing the 10 MB boundary (delta from last flush=0 ≥ 10 MB) flushes.
      vi.setSystemTime(base + 2_000);
      registry.update("job-A", { bytesDownloaded: TEN_MB });
      expect(registry.get("job-A")?.bytesDownloaded).toBe(TEN_MB);
      expect(readRow(db, "job-A")?.bytes_downloaded).toBe(TEN_MB);
      expect(readRow(db, "job-A")?.updated_at).toBe(base + 2_000);
    });

    it("a sub-10MB update flushes once ≥30s has elapsed since the last flush", () => {
      vi.useFakeTimers();
      const base = 1_700_000_000_000;
      vi.setSystemTime(base);

      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A", contentLength: null }));

      // A small update shortly after set: under both thresholds → no flush.
      vi.setSystemTime(base + 5_000);
      registry.update("job-A", { bytesDownloaded: 1_000 });
      expect(readRow(db, "job-A")?.bytes_downloaded).toBe(0);

      // Advance past 30s from the last flush (which was `set` at `base`). Even
      // a tiny byte delta now flushes on the time branch.
      vi.setSystemTime(base + 31_000);
      registry.update("job-A", { bytesDownloaded: 2_000 });
      expect(readRow(db, "job-A")?.bytes_downloaded).toBe(2_000);
      expect(readRow(db, "job-A")?.updated_at).toBe(base + 31_000);
    });

    it("update flushes content_length alongside bytes and a contentLength-only update does not clobber bytes", () => {
      vi.useFakeTimers();
      const base = 1_700_000_000_000;
      vi.setSystemTime(base);

      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A", contentLength: null }));

      // Force a flush via the 10MB branch carrying both fields.
      vi.setSystemTime(base + 1_000);
      registry.update("job-A", {
        bytesDownloaded: TEN_MB,
        contentLength: 50_000_000,
      });
      expect(readRow(db, "job-A")?.bytes_downloaded).toBe(TEN_MB);
      expect(readRow(db, "job-A")?.content_length).toBe(50_000_000);

      // A contentLength-only update that also trips the time branch must write
      // content_length WITHOUT clobbering bytes_downloaded to NULL/undefined.
      vi.setSystemTime(base + 40_000);
      registry.update("job-A", { contentLength: 60_000_000 });
      const row = readRow(db, "job-A");
      expect(row?.content_length).toBe(60_000_000);
      expect(row?.bytes_downloaded).toBe(TEN_MB); // preserved from memory
    });

    it("update on a missing id never touches the db (pure no-op, no stray row)", () => {
      const { registry, db } = makeRegistry();
      registry.update("ghost", { bytesDownloaded: 5_000 });
      expect(readRow(db, "ghost")).toBeUndefined();
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM downloads")
        .get() as { n: number };
      expect(count.n).toBe(0);
    });
  });

  describe("db mirror — finalize writes the terminal row and clears memory", () => {
    it("finalize completed: force-flushes final bytes (below threshold), sets ended_at, clears memory + byKey", () => {
      vi.useFakeTimers();
      const base = 1_700_000_000_000;
      vi.setSystemTime(base);

      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      // A tiny progress tick that the throttle would NOT flush.
      registry.update("job-A", { bytesDownloaded: 1_234 });
      expect(readRow(db, "job-A")?.bytes_downloaded).toBe(0); // throttled

      vi.setSystemTime(base + 7_000);
      registry.finalize("job-A", {
        status: "completed",
        bytesDownloaded: 1_048_576,
      });

      const row = readRow(db, "job-A");
      expect(row?.status).toBe("completed");
      expect(row?.bytes_downloaded).toBe(1_048_576); // forced flush, ignores throttle
      expect(row?.failure_tag).toBeNull();
      expect(row?.failure_message).toBeNull();
      expect(row?.ended_at).toBe(base + 7_000);
      expect(row?.updated_at).toBe(base + 7_000);

      // Memory + reverse index cleaned up (same as the old `delete`).
      expect(registry.get("job-A")).toBeUndefined();
      expect(registry.findByKey("ds-1", "/welcome.pdf")).toBeUndefined();
      expect(registry.size()).toBe(0);
    });

    it("finalize cancelled: status cancelled, no failure metadata, memory cleared", () => {
      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      registry.finalize("job-A", { status: "cancelled", bytesDownloaded: 9_000 });

      const row = readRow(db, "job-A");
      expect(row?.status).toBe("cancelled");
      expect(row?.bytes_downloaded).toBe(9_000);
      expect(row?.failure_tag).toBeNull();
      expect(row?.failure_message).toBeNull();
      expect(row?.ended_at).not.toBeNull();
      expect(registry.get("job-A")).toBeUndefined();
    });

    it("finalize failed: persists status, failure_tag, failure_message", () => {
      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A" }));
      registry.finalize("job-A", {
        status: "failed",
        failureTag: "provider-error",
        failureMessage: "503 from provider",
        bytesDownloaded: 42,
      });

      const row = readRow(db, "job-A");
      expect(row?.status).toBe("failed");
      expect(row?.failure_tag).toBe("provider-error");
      expect(row?.failure_message).toBe("503 from provider");
      expect(row?.bytes_downloaded).toBe(42);
      expect(row?.ended_at).not.toBeNull();
      expect(registry.get("job-A")).toBeUndefined();
    });

    it("finalize falls back to the in-memory bytes when outcome.bytesDownloaded is omitted", () => {
      const { registry, db } = makeRegistry();
      registry.set(makeEntry({ downloadJobId: "job-A", bytesDownloaded: 0 }));
      registry.update("job-A", { bytesDownloaded: 7_777 });
      // No bytesDownloaded in the outcome → uses current memory bytes (7_777).
      registry.finalize("job-A", { status: "completed" });
      expect(readRow(db, "job-A")?.bytes_downloaded).toBe(7_777);
    });

    it("finalize on an unknown id is a silent no-op (no throw, 0 rows affected)", () => {
      const { registry, db } = makeRegistry();
      const outcome: DownloadFinalizeOutcome = { status: "completed" };
      expect(() => registry.finalize("ghost", outcome)).not.toThrow();
      expect(readRow(db, "ghost")).toBeUndefined();
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM downloads")
        .get() as { n: number };
      expect(count.n).toBe(0);
    });
  });
});
