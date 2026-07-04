// add-download-history-ui §5.1 — handleSyncSetConfig
//
// Wraps `SyncClient.setConfig(req)` so the renderer-facing
// `SyncSetConfigResponse` envelope is constructed at the desktop boundary.
// An invalid downloadHistory (or schemaVersion) is rejected service-side as
// `io-error`; the client throws `SyncCommandError`, which the handler maps to
// `{ ok: false, error }` so the renderer's config helper can surface it.

import { describe, expect, it, vi } from "vitest";

import type {
  ServiceConfig,
  SyncSetConfigRequest,
} from "@cloudstash/ipc-contracts/sync-service-desktop";

import type { SyncClient } from "../../../sync/client.js";
import { SyncCommandError } from "../../../sync/client.js";
import { handleSyncSetConfig } from "../set-config.js";

function makeFakeClient(impl: () => Promise<unknown>): {
  client: SyncClient;
  setConfig: ReturnType<typeof vi.fn>;
} {
  const setConfig = vi.fn(impl);
  const client = { setConfig } as unknown as SyncClient;
  return { client, setConfig };
}

const CONFIG: ServiceConfig = {
  schemaVersion: 1,
  providers: { "google-drive": { clientId: "X", clientSecret: "Y" } },
  downloadHistory: { autoPrune: false, retentionDays: 180 },
};

describe("handleSyncSetConfig", () => {
  it("proxies the config through and wraps { ok: true } in the ok envelope", async () => {
    const { client, setConfig } = makeFakeClient(async () => ({ ok: true }));
    const req: SyncSetConfigRequest = { config: CONFIG };

    const res = await handleSyncSetConfig(req, client);

    expect(setConfig).toHaveBeenCalledTimes(1);
    expect(setConfig).toHaveBeenCalledWith({ config: CONFIG });
    expect(res).toEqual({ ok: true, result: { ok: true } });
  });

  it("maps an io-error SyncCommandError to the error envelope", async () => {
    const { client } = makeFakeClient(async () => {
      throw new SyncCommandError("sync:set-config", {
        tag: "io-error",
        message: "downloadHistory is invalid",
      });
    });

    const res = await handleSyncSetConfig(
      { config: CONFIG },
      client,
    );

    expect(res).toEqual({
      ok: false,
      error: { tag: "io-error", message: "downloadHistory is invalid" },
    });
  });

  it("re-throws a non-SyncCommandError (transport failure)", async () => {
    const err = new Error("service-disconnected");
    const { client } = makeFakeClient(async () => {
      throw err;
    });

    await expect(
      handleSyncSetConfig({ config: CONFIG }, client),
    ).rejects.toBe(err);
  });
});
