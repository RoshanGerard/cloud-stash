// add-download-history-ui §5.1 — handleSyncGetConfig
//
// Wraps `SyncClient.getConfig()` so the renderer-facing
// `SyncGetConfigResponse` envelope (`{ ok: true, result } | { ok: false,
// error }`) is constructed at the desktop boundary, mirroring the
// authenticate-start bridge. The client returns the bare
// `CommandResult<"sync:get-config">` and throws `SyncCommandError` on a
// service `{ ok: false }`.

import { describe, expect, it, vi } from "vitest";

import type { ServiceConfig } from "@ft5/ipc-contracts/sync-service-desktop";

import type { SyncClient } from "../../../sync/client.js";
import { SyncCommandError } from "../../../sync/client.js";
import { handleSyncGetConfig } from "../get-config.js";

function makeFakeClient(impl: () => Promise<unknown>): {
  client: SyncClient;
  getConfig: ReturnType<typeof vi.fn>;
} {
  const getConfig = vi.fn(impl);
  const client = { getConfig } as unknown as SyncClient;
  return { client, getConfig };
}

const CONFIG: ServiceConfig = {
  schemaVersion: 1,
  providers: { "google-drive": { clientId: "X", clientSecret: "Y" } },
  downloadHistory: { autoPrune: true, retentionDays: 90 },
};

describe("handleSyncGetConfig", () => {
  it("invokes getConfig with empty params and wraps the result in the ok envelope", async () => {
    const { client, getConfig } = makeFakeClient(async () => ({
      config: CONFIG,
    }));

    const res = await handleSyncGetConfig(client);

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(getConfig).toHaveBeenCalledWith({});
    expect(res).toEqual({ ok: true, result: { config: CONFIG } });
  });

  it("maps a SyncCommandError to the error envelope (preserving the wire error)", async () => {
    const { client } = makeFakeClient(async () => {
      throw new SyncCommandError("sync:get-config", {
        tag: "io-error",
        message: "config.json unreadable",
      });
    });

    const res = await handleSyncGetConfig(client);

    expect(res).toEqual({
      ok: false,
      error: { tag: "io-error", message: "config.json unreadable" },
    });
  });

  it("re-throws a non-SyncCommandError (transport failure surfaces as invoke rejection)", async () => {
    const err = new Error("service-disconnected");
    const { client } = makeFakeClient(async () => {
      throw err;
    });

    await expect(handleSyncGetConfig(client)).rejects.toBe(err);
  });
});
