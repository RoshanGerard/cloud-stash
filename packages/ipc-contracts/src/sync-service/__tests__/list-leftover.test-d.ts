// Type-level assertions for the `add-leftover-download-cleanup` wire
// contract addition:
//   `downloads:list-leftover` command — `{} -> { entries: LeftoverEntry[] }`.
//   An empty request (the service returns the retention-bounded failure
//   subset narrowed to files still on disk); the response is the standard
//   tagged envelope + `FilesCommandErrorShape`, mirroring the other
//   `downloads:*` read commands (`downloads:list-active`). Each
//   `LeftoverEntry` carries the durable `downloads` row values plus a
//   service-side `sizeOnDisk` from a `stat` of the partial's `target_path`.
//
// `add-leftover-entry-status` adds the required `status` field and the
// `LeftoverStatus` vocabulary typing it — the row's actual terminal
// disposition, which the handler's query already filters on but never
// projected. The assertions below pin that it is REQUIRED (no row may be
// unlabelled, so the renderer needs no generic fallback) and that it is
// derived as `DownloadTerminalStatus` minus `completed`, giving the renderer
// an exhaustive three-case match with no unreachable branch.

import { describe, expectTypeOf, it } from "vitest";

import type {
  COMMAND_NAMES,
  CommandError,
  CommandMap,
  CommandName,
  CommandParams,
  CommandResult,
  DownloadsListLeftoverRequest,
  DownloadsListLeftoverResponse,
  DownloadTerminalStatus,
  FilesCommandErrorShape,
  LeftoverEntry,
  LeftoverStatus,
} from "../commands.js";

describe("sync-service downloads:list-leftover command contract", () => {
  it("CommandMap registers downloads:list-leftover", () => {
    expectTypeOf<CommandMap["downloads:list-leftover"]>().not.toBeNever();
  });

  it("CommandName includes downloads:list-leftover", () => {
    expectTypeOf<"downloads:list-leftover">().toMatchTypeOf<CommandName>();
  });

  it("COMMAND_NAMES tuple contains downloads:list-leftover", () => {
    type Names = (typeof COMMAND_NAMES)[number];
    expectTypeOf<"downloads:list-leftover">().toMatchTypeOf<Names>();
  });

  it("downloads:list-leftover params are empty (Record<string, never>)", () => {
    expectTypeOf<CommandParams<"downloads:list-leftover">>().toEqualTypeOf<Record<string, never>>();
  });

  it("downloads:list-leftover result is { entries: readonly LeftoverEntry[] }", () => {
    expectTypeOf<CommandResult<"downloads:list-leftover">>().toEqualTypeOf<{
      readonly entries: readonly LeftoverEntry[];
    }>();
  });

  it("downloads:list-leftover error carries the FilesCommandErrorShape", () => {
    expectTypeOf<CommandError<"downloads:list-leftover">>().toEqualTypeOf<FilesCommandErrorShape>();
  });

  it("DownloadsListLeftoverRequest and DownloadsListLeftoverResponse alias the envelope shape", () => {
    expectTypeOf<DownloadsListLeftoverRequest>().toEqualTypeOf<Record<string, never>>();

    type ResponseOk = Extract<DownloadsListLeftoverResponse, { ok: true }>;
    type ResponseErr = Extract<DownloadsListLeftoverResponse, { ok: false }>;
    expectTypeOf<ResponseOk["value"]>().toEqualTypeOf<{
      readonly entries: readonly LeftoverEntry[];
    }>();
    expectTypeOf<ResponseErr["error"]>().toEqualTypeOf<FilesCommandErrorShape>();
  });
});

describe("LeftoverEntry shape", () => {
  it("has exactly the nine documented readonly fields with the stated types", () => {
    expectTypeOf<LeftoverEntry>().toEqualTypeOf<{
      readonly downloadJobId: string;
      readonly datasourceId: string;
      readonly sourcePath: string;
      readonly targetPath: string;
      readonly sizeOnDisk: number;
      readonly status: LeftoverStatus;
      readonly failureTag: string | null;
      readonly failureMessage: string | null;
      readonly endedAt: number | null;
    }>();
  });

  it("sizeOnDisk is a number (bytes-on-disk from a service-side stat)", () => {
    expectTypeOf<LeftoverEntry["sizeOnDisk"]>().toEqualTypeOf<number>();
  });

  it("status is required and NOT nullable — every row has a terminal disposition", () => {
    expectTypeOf<LeftoverEntry["status"]>().toEqualTypeOf<LeftoverStatus>();
    expectTypeOf<LeftoverEntry>().toHaveProperty("status");
    expectTypeOf<null>().not.toMatchTypeOf<LeftoverEntry["status"]>();
    expectTypeOf<undefined>().not.toMatchTypeOf<LeftoverEntry["status"]>();
  });

  it("failureTag / failureMessage / endedAt are nullable stored row values", () => {
    expectTypeOf<LeftoverEntry["failureTag"]>().toEqualTypeOf<string | null>();
    expectTypeOf<LeftoverEntry["failureMessage"]>().toEqualTypeOf<string | null>();
    expectTypeOf<LeftoverEntry["endedAt"]>().toEqualTypeOf<number | null>();
  });
});

describe("LeftoverStatus wire vocabulary (add-leftover-entry-status Decision 2)", () => {
  it("is exactly the three KEEP-eligible terminal statuses", () => {
    expectTypeOf<LeftoverStatus>().toEqualTypeOf<"failed" | "cancelled" | "interrupted">();
  });

  it("each KEEP-eligible value is assignable", () => {
    expectTypeOf<"failed">().toMatchTypeOf<LeftoverStatus>();
    expectTypeOf<"cancelled">().toMatchTypeOf<LeftoverStatus>();
    expectTypeOf<"interrupted">().toMatchTypeOf<LeftoverStatus>();
  });

  it('excludes "completed" — a completed download leaves no leftover partial', () => {
    expectTypeOf<"completed">().not.toMatchTypeOf<LeftoverStatus>();
  });

  it('excludes the live "in-flight" status, which never crosses this wire', () => {
    expectTypeOf<"in-flight">().not.toMatchTypeOf<LeftoverStatus>();
  });

  it("is derived from DownloadTerminalStatus, so it stays a strict subset of it", () => {
    expectTypeOf<LeftoverStatus>().toMatchTypeOf<DownloadTerminalStatus>();
    expectTypeOf<LeftoverStatus>().toEqualTypeOf<Exclude<DownloadTerminalStatus, "completed">>();
  });
});
