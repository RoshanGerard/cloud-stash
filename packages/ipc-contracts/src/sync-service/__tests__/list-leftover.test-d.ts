// Type-level assertions for the `add-leftover-download-cleanup` wire
// contract addition:
//   `downloads:list-leftover` command — `{} -> { entries: LeftoverEntry[] }`.
//   An empty request (the service returns the retention-bounded failure
//   subset narrowed to files still on disk); the response is the standard
//   tagged envelope + `FilesCommandErrorShape`, mirroring the other
//   `downloads:*` read commands (`downloads:list-active`). Each
//   `LeftoverEntry` carries the durable `downloads` row values plus a
//   service-side `sizeOnDisk` from a `stat` of the partial's `target_path`.

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
  FilesCommandErrorShape,
  LeftoverEntry,
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
  it("has exactly the eight documented readonly fields with the stated types", () => {
    expectTypeOf<LeftoverEntry>().toEqualTypeOf<{
      readonly downloadJobId: string;
      readonly datasourceId: string;
      readonly sourcePath: string;
      readonly targetPath: string;
      readonly sizeOnDisk: number;
      readonly failureTag: string | null;
      readonly failureMessage: string | null;
      readonly endedAt: number | null;
    }>();
  });

  it("sizeOnDisk is a number (bytes-on-disk from a service-side stat)", () => {
    expectTypeOf<LeftoverEntry["sizeOnDisk"]>().toEqualTypeOf<number>();
  });

  it("failureTag / failureMessage / endedAt are nullable stored row values", () => {
    expectTypeOf<LeftoverEntry["failureTag"]>().toEqualTypeOf<string | null>();
    expectTypeOf<LeftoverEntry["failureMessage"]>().toEqualTypeOf<string | null>();
    expectTypeOf<LeftoverEntry["endedAt"]>().toEqualTypeOf<number | null>();
  });
});
