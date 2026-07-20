// Type-level assertions for the download-history management contract added by
// `add-download-history-ui` (design.md Decisions 2, 5, 6):
//
//   - `ServiceConfig` gains an OPTIONAL `downloadHistory` retention field,
//     additive at the unchanged config `schemaVersion: 1`.
//   - `DownloadTerminalStatus` promotes the four terminal download statuses
//     (`completed | failed | cancelled | interrupted`, excluding `in-flight`)
//     to the wire for the first time — the filter vocabulary for clear.
//   - `downloads:clear-history` is a new command whose params carry an
//     optional `{ status?, olderThanMs? }` filter and whose result is
//     `{ deleted: number }`, riding the standard tagged envelope.

import { describe, expectTypeOf, it } from "vitest";

import type {
  COMMAND_NAMES,
  ClearDownloadHistoryRequest,
  ClearDownloadHistoryResponse,
  CommandError,
  CommandMap,
  CommandName,
  CommandParams,
  CommandResult,
  DownloadTerminalStatus,
  FilesCommandErrorShape,
  ServiceConfig,
} from "../commands.js";

describe("ServiceConfig download-history retention field", () => {
  it("ServiceConfig carries an optional downloadHistory field", () => {
    expectTypeOf<ServiceConfig["downloadHistory"]>().toEqualTypeOf<
      | {
          readonly autoPrune: boolean;
          readonly retentionDays: 30 | 90 | 180 | 365;
        }
      | undefined
    >();
  });

  it("a config WITHOUT downloadHistory is still valid (additive field)", () => {
    const minimal = { schemaVersion: 1, providers: {} } as const;
    expectTypeOf(minimal).toMatchTypeOf<ServiceConfig>();
  });

  it("a config carrying downloadHistory is assignable", () => {
    const withHistory = {
      schemaVersion: 1,
      providers: {},
      downloadHistory: { autoPrune: false, retentionDays: 180 },
    } as const;
    expectTypeOf(withHistory).toMatchTypeOf<ServiceConfig>();
  });

  it("retentionDays is restricted to the preset union", () => {
    expectTypeOf<NonNullable<ServiceConfig["downloadHistory"]>["retentionDays"]>().toEqualTypeOf<
      30 | 90 | 180 | 365
    >();
  });
});

describe("DownloadTerminalStatus wire vocabulary", () => {
  it("is exactly the four terminal statuses", () => {
    expectTypeOf<DownloadTerminalStatus>().toEqualTypeOf<
      "completed" | "failed" | "cancelled" | "interrupted"
    >();
  });

  it("does NOT include the in-flight status", () => {
    expectTypeOf<"in-flight">().not.toMatchTypeOf<DownloadTerminalStatus>();
  });
});

describe("sync-service downloads:clear-history command contract", () => {
  it("CommandMap registers downloads:clear-history", () => {
    expectTypeOf<CommandMap["downloads:clear-history"]>().not.toBeNever();
  });

  it("CommandName includes downloads:clear-history", () => {
    expectTypeOf<"downloads:clear-history">().toMatchTypeOf<CommandName>();
  });

  it("COMMAND_NAMES tuple contains downloads:clear-history", () => {
    type Names = (typeof COMMAND_NAMES)[number];
    expectTypeOf<"downloads:clear-history">().toMatchTypeOf<Names>();
  });

  it("params carry an optional status/age filter", () => {
    expectTypeOf<CommandParams<"downloads:clear-history">>().toEqualTypeOf<{
      readonly filter?: {
        readonly status?: readonly DownloadTerminalStatus[];
        readonly olderThanMs?: number;
      };
    }>();
  });

  it("result is { deleted: number }", () => {
    expectTypeOf<CommandResult<"downloads:clear-history">>().toEqualTypeOf<{
      readonly deleted: number;
    }>();
  });

  it("error carries the FilesCommandErrorShape", () => {
    expectTypeOf<CommandError<"downloads:clear-history">>().toEqualTypeOf<FilesCommandErrorShape>();
  });

  it("Request and Response aliases match the envelope shape", () => {
    expectTypeOf<ClearDownloadHistoryRequest>().toEqualTypeOf<{
      readonly filter?: {
        readonly status?: readonly DownloadTerminalStatus[];
        readonly olderThanMs?: number;
      };
    }>();

    type ResponseOk = Extract<ClearDownloadHistoryResponse, { ok: true }>;
    type ResponseErr = Extract<ClearDownloadHistoryResponse, { ok: false }>;
    expectTypeOf<ResponseOk["value"]>().toEqualTypeOf<{
      readonly deleted: number;
    }>();
    expectTypeOf<ResponseErr["error"]>().toEqualTypeOf<FilesCommandErrorShape>();
  });
});
