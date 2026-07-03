// add-failed-download-cleanup-affordance §4 — handleDeletePartial
//
// Near-identity proxy over `SyncClient.deletePartial`. Passes the flat
// `{ deleted }` result through verbatim on success; a meaningful failure
// (in-flight refusal, EACCES/EPERM) or a transport failure re-throws and
// surfaces to the renderer as an IPC invoke rejection.

import { describe, expect, it, vi } from "vitest";

import type { SyncDeletePartialRequest } from "@ft5/ipc-contracts/sync-service-desktop";

import type { SyncClient } from "../../../sync/client.js";
import { handleDeletePartial } from "../delete-partial.js";

function makeFakeClient(impl: (req: SyncDeletePartialRequest) => Promise<unknown>): {
  client: SyncClient;
  deletePartial: ReturnType<typeof vi.fn>;
} {
  const deletePartial = vi.fn(impl);
  const client = { deletePartial } as unknown as SyncClient;
  return { client, deletePartial };
}

describe("handleDeletePartial", () => {
  it("proxies the downloadJobId and returns { deleted } verbatim", async () => {
    const { client, deletePartial } = makeFakeClient(async () => ({
      deleted: true,
    }));
    const req: SyncDeletePartialRequest = { downloadJobId: "job-A" };

    const res = await handleDeletePartial(req, client);

    expect(deletePartial).toHaveBeenCalledTimes(1);
    expect(deletePartial).toHaveBeenCalledWith({ downloadJobId: "job-A" });
    expect(res).toEqual({ deleted: true });
  });

  it("passes through a no-op result ({ deleted: false }) for an unrecorded job", async () => {
    const { client, deletePartial } = makeFakeClient(async () => ({
      deleted: false,
    }));

    const res = await handleDeletePartial({ downloadJobId: "nope" }, client);

    expect(deletePartial).toHaveBeenCalledWith({ downloadJobId: "nope" });
    expect(res).toEqual({ deleted: false });
  });

  it("re-throws underlying client errors (in-flight refusal / permission / transport)", async () => {
    const err = new Error("download is still in flight");
    const { client } = makeFakeClient(async () => {
      throw err;
    });

    await expect(
      handleDeletePartial({ downloadJobId: "live" }, client),
    ).rejects.toBe(err);
  });
});
