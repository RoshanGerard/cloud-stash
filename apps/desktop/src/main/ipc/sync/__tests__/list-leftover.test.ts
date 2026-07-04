// add-leftover-download-cleanup §2.5 — handleListLeftover
//
// Near-identity proxy over `SyncClient.listLeftover`. The renderer-facing
// `SyncListLeftoverRequest` is `void`; the wire params shape is
// `Record<string, never>`, so the handler passes an empty object through
// (mirrors `handleSyncGetStatus`). The flat `{ entries }` result passes
// through verbatim — no field projection. A transport failure re-throws and
// surfaces to the renderer as an IPC invoke rejection.

import { describe, expect, it, vi } from "vitest";

import type { LeftoverEntry } from "@cloudstash/ipc-contracts/sync-service-desktop";

import type { SyncClient } from "../../../sync/client.js";
import { SyncCommandError } from "../../../sync/client.js";
import { handleListLeftover } from "../list-leftover.js";

function makeFakeClient(impl: (params: unknown) => Promise<unknown>): {
  client: SyncClient;
  listLeftover: ReturnType<typeof vi.fn>;
} {
  const listLeftover = vi.fn(impl);
  // Only `listLeftover` is exercised by the handler. Cast via `unknown` so
  // the partial shape type-checks without implementing the full `SyncClient`.
  const client = { listLeftover } as unknown as SyncClient;
  return { client, listLeftover };
}

const ENTRY: LeftoverEntry = {
  downloadJobId: "job-A",
  datasourceId: "ds-1",
  sourcePath: "/remote/report.pdf",
  targetPath: "/downloads/report.pdf",
  sizeOnDisk: 1024,
  failureTag: "network-error",
  failureMessage: "connection reset",
  endedAt: 1_700_000_000_000,
};

describe("handleListLeftover", () => {
  it("invokes client.listLeftover with an empty params object and returns { entries } verbatim", async () => {
    const wireResult = { entries: [ENTRY] } as const;
    const { client, listLeftover } = makeFakeClient(async () => wireResult);

    const res = await handleListLeftover(undefined, client);

    expect(listLeftover).toHaveBeenCalledTimes(1);
    expect(listLeftover).toHaveBeenCalledWith({});
    expect(res).toBe(wireResult);
  });

  it("passes through an empty result ({ entries: [] })", async () => {
    const { client, listLeftover } = makeFakeClient(async () => ({
      entries: [],
    }));

    const res = await handleListLeftover(undefined, client);

    expect(listLeftover).toHaveBeenCalledWith({});
    expect(res).toEqual({ entries: [] });
  });

  it("re-throws SyncCommandError failures", async () => {
    const err = new SyncCommandError("downloads:list-leftover", {
      tag: "internal-error",
      message: "boom",
    });
    const { client } = makeFakeClient(async () => {
      throw err;
    });

    await expect(handleListLeftover(undefined, client)).rejects.toBe(err);
  });

  it("re-throws non-SyncCommandError failures (e.g. service-disconnected)", async () => {
    const err = new Error("service-disconnected");
    const { client } = makeFakeClient(async () => {
      throw err;
    });

    await expect(handleListLeftover(undefined, client)).rejects.toBe(err);
  });
});
