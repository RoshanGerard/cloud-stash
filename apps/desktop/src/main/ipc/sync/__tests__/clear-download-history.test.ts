// add-download-history-ui §5.1 — handleClearDownloadHistory
//
// Near-identity proxy over `SyncClient.clearDownloadHistory`. Mirrors the
// `uploads-list-active` scaffold: the service handler is effectively
// infallible (always `{ deleted }`), so the desktop proxy returns the flat
// result verbatim and transport failures re-throw (surface as renderer-side
// invoke rejections).

import { describe, expect, it, vi } from "vitest";

import type { SyncClearDownloadHistoryRequest } from "@ft5/ipc-contracts/sync-service-desktop";

import type { SyncClient } from "../../../sync/client.js";
import { handleClearDownloadHistory } from "../clear-download-history.js";

function makeFakeClient(impl: (req: SyncClearDownloadHistoryRequest) => Promise<unknown>): {
  client: SyncClient;
  clearDownloadHistory: ReturnType<typeof vi.fn>;
} {
  const clearDownloadHistory = vi.fn(impl);
  const client = { clearDownloadHistory } as unknown as SyncClient;
  return { client, clearDownloadHistory };
}

describe("handleClearDownloadHistory", () => {
  it("proxies the filter and returns { deleted } verbatim", async () => {
    const { client, clearDownloadHistory } = makeFakeClient(async () => ({
      deleted: 3,
    }));
    const req: SyncClearDownloadHistoryRequest = {
      filter: { status: ["failed", "interrupted"] },
    };

    const res = await handleClearDownloadHistory(req, client);

    expect(clearDownloadHistory).toHaveBeenCalledTimes(1);
    expect(clearDownloadHistory).toHaveBeenCalledWith({
      filter: { status: ["failed", "interrupted"] },
    });
    expect(res).toEqual({ deleted: 3 });
  });

  it("passes a no-filter request through (clear all terminal rows)", async () => {
    const { client, clearDownloadHistory } = makeFakeClient(async () => ({
      deleted: 0,
    }));

    const res = await handleClearDownloadHistory({}, client);

    expect(clearDownloadHistory).toHaveBeenCalledWith({});
    expect(res).toEqual({ deleted: 0 });
  });

  it("re-throws underlying client errors (transport failure)", async () => {
    const err = new Error("service-disconnected");
    const { client } = makeFakeClient(async () => {
      throw err;
    });

    await expect(
      handleClearDownloadHistory({ filter: { olderThanMs: 1000 } }, client),
    ).rejects.toBe(err);
  });
});
