/** @vitest-environment jsdom */
//
// add-download-history-ui §6.1 — renderer read-modify-write config helper.
//
// CRITICAL (design.md Decision 7): writing a download-history setting MUST read
// the latest config, merge ONLY `downloadHistory`, and write back — preserving
// `schemaVersion` + the existing `providers` (the OAuth app secrets). A naive
// `{ schemaVersion: 1, providers: {}, downloadHistory }` write would WIPE the
// secrets because `sync:set-config` overwrites config.json wholesale.

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  DOWNLOAD_HISTORY_DEFAULT,
  readDownloadHistorySettings,
  writeDownloadHistorySettings,
} from "../download-history-config";

let getConfigMock: Mock;
let setConfigMock: Mock;

function installApiMock(): void {
  getConfigMock = vi.fn();
  setConfigMock = vi.fn().mockResolvedValue({ ok: true, result: { ok: true } });
  (window as unknown as { api: unknown }).api = {
    sync: { getConfig: getConfigMock, setConfig: setConfigMock },
  };
}

beforeEach(() => {
  installApiMock();
});

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { api?: unknown }).api;
});

describe("writeDownloadHistorySettings — read-modify-write (Decision 7, CRITICAL)", () => {
  it("preserves existing providers (OAuth secrets) when writing a downloadHistory change", async () => {
    getConfigMock.mockResolvedValue({
      ok: true,
      result: {
        config: {
          schemaVersion: 1,
          providers: { "google-drive": { clientId: "X", clientSecret: "Y" } },
        },
      },
    });

    await writeDownloadHistorySettings({ autoPrune: false });

    expect(setConfigMock).toHaveBeenCalledTimes(1);
    expect(setConfigMock).toHaveBeenCalledWith({
      config: {
        schemaVersion: 1,
        providers: { "google-drive": { clientId: "X", clientSecret: "Y" } },
        downloadHistory: { autoPrune: false, retentionDays: 90 },
      },
    });
  });

  it("bases the merge on a FRESH getConfig immediately before setConfig (concurrent-safe)", async () => {
    const order: string[] = [];
    getConfigMock.mockImplementation(async () => {
      order.push("get");
      return { ok: true, result: { config: { schemaVersion: 1, providers: {} } } };
    });
    setConfigMock.mockImplementation(async () => {
      order.push("set");
      return { ok: true, result: { ok: true } };
    });

    await writeDownloadHistorySettings({ retentionDays: 180 });

    expect(order).toEqual(["get", "set"]);
  });

  it("merges a partial patch onto the current stored settings (keeps the untouched field)", async () => {
    getConfigMock.mockResolvedValue({
      ok: true,
      result: {
        config: {
          schemaVersion: 1,
          providers: {},
          downloadHistory: { autoPrune: false, retentionDays: 30 },
        },
      },
    });

    await writeDownloadHistorySettings({ retentionDays: 180 });

    expect(setConfigMock).toHaveBeenCalledWith({
      config: {
        schemaVersion: 1,
        providers: {},
        downloadHistory: { autoPrune: false, retentionDays: 180 },
      },
    });
  });

  it("defaults the base settings when downloadHistory is absent, then applies the patch", async () => {
    getConfigMock.mockResolvedValue({
      ok: true,
      result: { config: { schemaVersion: 1, providers: {} } },
    });

    await writeDownloadHistorySettings({ retentionDays: 365 });

    expect(setConfigMock).toHaveBeenCalledWith({
      config: {
        schemaVersion: 1,
        providers: {},
        downloadHistory: { autoPrune: true, retentionDays: 365 },
      },
    });
  });

  it("ABORTS the write (does NOT call setConfig) when getConfig fails — never wipes providers", async () => {
    // A failed read on a file that likely contains OAuth secrets must not be
    // overwritten with an empty config (Decision 7). Review C1/C2.
    getConfigMock.mockResolvedValue({
      ok: false,
      error: { tag: "io-error", message: "config.json is corrupt" },
    });

    const res = await writeDownloadHistorySettings({ autoPrune: false });

    expect(setConfigMock).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.tag).toBe("io-error");
  });

  it("returns the setConfig response so callers can surface io-error", async () => {
    getConfigMock.mockResolvedValue({
      ok: true,
      result: { config: { schemaVersion: 1, providers: {} } },
    });
    setConfigMock.mockResolvedValue({
      ok: false,
      error: { tag: "io-error", message: "boom" },
    });

    const res = await writeDownloadHistorySettings({ autoPrune: false });

    expect(res).toEqual({ ok: false, error: { tag: "io-error", message: "boom" } });
  });
});

describe("readDownloadHistorySettings", () => {
  it("returns the stored settings when present and valid", async () => {
    getConfigMock.mockResolvedValue({
      ok: true,
      result: {
        config: {
          schemaVersion: 1,
          providers: {},
          downloadHistory: { autoPrune: false, retentionDays: 180 },
        },
      },
    });

    expect(await readDownloadHistorySettings()).toEqual({
      autoPrune: false,
      retentionDays: 180,
    });
  });

  it("returns the default for absent or malformed downloadHistory", async () => {
    getConfigMock.mockResolvedValue({
      ok: true,
      result: {
        config: {
          schemaVersion: 1,
          providers: {},
          downloadHistory: { autoPrune: "yes", retentionDays: 7 },
        },
      },
    });

    expect(await readDownloadHistorySettings()).toEqual(DOWNLOAD_HISTORY_DEFAULT);
  });

  it("returns the default when getConfig fails", async () => {
    getConfigMock.mockResolvedValue({
      ok: false,
      error: { tag: "io-error", message: "x" },
    });

    expect(await readDownloadHistorySettings()).toEqual(DOWNLOAD_HISTORY_DEFAULT);
  });
});
