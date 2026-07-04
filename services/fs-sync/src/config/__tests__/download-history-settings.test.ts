// Tests for the download-history retention resolver + validation predicate
// (add-download-history-ui tasks §2.1, design.md Decision 2). The resolver is
// the READ SITE that applies the default `{ autoPrune: true, retentionDays:
// 90 }` for absent OR malformed `downloadHistory`, because
// `ServiceConfigStore.read`'s `as ServiceConfig` cast does NOT validate the
// field's shape. `isValidDownloadHistory` is the shared predicate the
// `sync:set-config` validation path reuses.

import { describe, expect, it } from "vitest";

import type { ServiceConfig } from "@cloudstash/ipc-contracts/sync-service";

import {
  DEFAULT_RETENTION_SETTINGS,
  isValidDownloadHistory,
  resolveRetentionSettings,
} from "../download-history-settings.js";

// Build a config whose `downloadHistory` is whatever the test wants, bypassing
// the compile-time type — runtime values can be arbitrary (a hand-edited
// config.json) so the resolver must defend against them.
function configWith(downloadHistory: unknown): ServiceConfig {
  return { schemaVersion: 1, providers: {}, downloadHistory } as ServiceConfig;
}

describe("resolveRetentionSettings — defensive read (Decision 2)", () => {
  it("defaults to { autoPrune: true, retentionDays: 90 } when absent", () => {
    const config: ServiceConfig = { schemaVersion: 1, providers: {} };
    expect(resolveRetentionSettings(config)).toEqual({
      autoPrune: true,
      retentionDays: 90,
    });
  });

  it("returns the stored value when valid", () => {
    expect(
      resolveRetentionSettings(
        configWith({ autoPrune: false, retentionDays: 180 }),
      ),
    ).toEqual({ autoPrune: false, retentionDays: 180 });
  });

  it.each([30, 90, 180, 365] as const)(
    "accepts each preset retentionDays (%i)",
    (days) => {
      expect(
        resolveRetentionSettings(
          configWith({ autoPrune: true, retentionDays: days }),
        ),
      ).toEqual({ autoPrune: true, retentionDays: days });
    },
  );

  it.each([
    ["non-boolean autoPrune", { autoPrune: "yes", retentionDays: 90 }],
    ["off-set retentionDays 45", { autoPrune: true, retentionDays: 45 }],
    ["off-set retentionDays 0", { autoPrune: true, retentionDays: 0 }],
    ["off-set retentionDays 7", { autoPrune: false, retentionDays: 7 }],
    ["missing retentionDays", { autoPrune: true }],
    ["missing autoPrune", { retentionDays: 90 }],
    ["null", null],
    ["non-object", 42],
    ["array", []],
    ["both fields invalid", { autoPrune: "yes", retentionDays: 7 }],
  ])(
    "falls back to the default for malformed downloadHistory: %s",
    (_label, dh) => {
      expect(resolveRetentionSettings(configWith(dh))).toEqual(
        DEFAULT_RETENTION_SETTINGS,
      );
    },
  );
});

describe("isValidDownloadHistory — set-config validation predicate", () => {
  it("true for a valid value", () => {
    expect(isValidDownloadHistory({ autoPrune: true, retentionDays: 365 })).toBe(
      true,
    );
    expect(isValidDownloadHistory({ autoPrune: false, retentionDays: 30 })).toBe(
      true,
    );
  });

  it.each([
    { autoPrune: "yes", retentionDays: 90 },
    { autoPrune: true, retentionDays: 45 },
    { autoPrune: true },
    { retentionDays: 90 },
    null,
    42,
    [],
    { autoPrune: 1, retentionDays: 90 },
  ])("false for malformed: %o", (v) => {
    expect(isValidDownloadHistory(v)).toBe(false);
  });
});

describe("DEFAULT_RETENTION_SETTINGS", () => {
  it("is { autoPrune: true, retentionDays: 90 }", () => {
    expect(DEFAULT_RETENTION_SETTINGS).toEqual({
      autoPrune: true,
      retentionDays: 90,
    });
  });
});
