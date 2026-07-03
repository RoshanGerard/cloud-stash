// Type-level assertions for the `add-failed-download-cleanup-affordance`
// Phase 1 contract additions:
//   (A) `DownloadFailedPayload.partialKept?: boolean` — an OPTIONAL UI hint
//       telling the renderer whether a deletable partial file was kept on
//       disk for this terminal failure. Optional + default-false keeps it
//       backward compatible: a failure event from an older service (or a
//       hydrated toast) simply omits it.
//   (B) `downloads:delete-partial` command — `{ downloadJobId } -> { deleted }`.
//       The path is resolved server-side from the durable `downloads` row;
//       clients never pass a filesystem path. Mirrors the tagged envelope +
//       `FilesCommandErrorShape` used by the other `downloads:*` commands.

import { describe, expectTypeOf, it } from "vitest";

import type { DownloadFailedPayload } from "../events.js";
import type {
  COMMAND_NAMES,
  CommandError,
  CommandMap,
  CommandName,
  CommandParams,
  CommandResult,
  DeletePartialRequest,
  DeletePartialResponse,
  FilesCommandErrorShape,
} from "../commands.js";

describe("DownloadFailedPayload.partialKept optional field", () => {
  it("partialKept is boolean | undefined (optional)", () => {
    expectTypeOf<DownloadFailedPayload["partialKept"]>().toEqualTypeOf<
      boolean | undefined
    >();
  });

  it("a payload that omits partialKept is still a valid DownloadFailedPayload", () => {
    // Backward compatibility: the pre-change 4-field shape must remain
    // assignable, which is only true if partialKept is optional.
    expectTypeOf<{
      readonly downloadJobId: string;
      readonly datasourceId: string;
      readonly tag: DownloadFailedPayload["tag"];
      readonly message: string;
    }>().toMatchTypeOf<DownloadFailedPayload>();
  });
});

describe("sync-service downloads:delete-partial command contract", () => {
  it("CommandMap registers downloads:delete-partial", () => {
    expectTypeOf<CommandMap["downloads:delete-partial"]>().not.toBeNever();
  });

  it("CommandName includes downloads:delete-partial", () => {
    expectTypeOf<"downloads:delete-partial">().toMatchTypeOf<CommandName>();
  });

  it("COMMAND_NAMES tuple contains downloads:delete-partial", () => {
    type Names = (typeof COMMAND_NAMES)[number];
    expectTypeOf<"downloads:delete-partial">().toMatchTypeOf<Names>();
  });

  it("downloads:delete-partial params are { downloadJobId: string }", () => {
    expectTypeOf<CommandParams<"downloads:delete-partial">>().toEqualTypeOf<{
      readonly downloadJobId: string;
    }>();
  });

  it("downloads:delete-partial result is { deleted: boolean }", () => {
    expectTypeOf<CommandResult<"downloads:delete-partial">>().toEqualTypeOf<{
      readonly deleted: boolean;
    }>();
  });

  it("downloads:delete-partial error carries the FilesCommandErrorShape", () => {
    expectTypeOf<
      CommandError<"downloads:delete-partial">
    >().toEqualTypeOf<FilesCommandErrorShape>();
  });

  it("DeletePartialRequest and DeletePartialResponse alias the envelope shape", () => {
    expectTypeOf<DeletePartialRequest>().toEqualTypeOf<{
      readonly downloadJobId: string;
    }>();

    type ResponseOk = Extract<DeletePartialResponse, { ok: true }>;
    type ResponseErr = Extract<DeletePartialResponse, { ok: false }>;
    expectTypeOf<ResponseOk["value"]>().toEqualTypeOf<{
      readonly deleted: boolean;
    }>();
    expectTypeOf<ResponseErr["error"]>().toEqualTypeOf<FilesCommandErrorShape>();
  });
});
