// Tests for OAuthLoopbackBroker — reconnect account-anchor enforcement
// (enforce-oauth-reconnect-account-match §7, design.md D4 + D5).
//
// Two behaviors are exercised here, separate from the base broker suite:
//
//   §7.1/7.2 (anchor read, D4): on a reconnect (`start({ datasourceId })`),
//   the broker reads the datasource's stored anchor
//   (`credentialStore.get(datasourceId)?.authResult.meta.account`) and
//   threads it to `factory.createForAuth(...)` as the 5th positional arg
//   (`expectedAccount`). A datasource without a well-formed `{ sub, email }`
//   anchor passes `undefined` (capture-only).
//
//   §7.3/7.4 (tag mapping, D5): when `intent.completeWith(code)` rejects with
//   a `DatasourceError { tag: "account-mismatch" }`, the broker emits
//   `auth-failed { tag: "account-mismatch", message, expectedEmail,
//   actualEmail }` (lifted off the engine error's `raw`) and emits NO
//   `credential-persisted` / `auth-completed` pair. Every other rejection
//   continues to map to `provider-error`.
//
// Helper shape mirrors `loopback-broker.test.ts` but the factory records the
// threaded `expectedAccount` arg and the `completeWith` spy can be configured
// to reject, so we can assert both the read-side and the catch-side mapping
// without a real token exchange.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DatasourceError,
  DatasourceErrorTag,
} from "@cloudstash/ipc-contracts";
import type {
  AccountIdentity,
  AuthResult,
  ProviderId,
  StoredCredentials,
} from "@cloudstash/ipc-contracts";
import type {
  ClientFactory,
  CredentialStore,
  EngineContext,
  OAuthAppConfig,
  OAuthIntent,
} from "@cloudstash/fs-datasource-engine";

import { createEventBus, type EventBus } from "../../events/event-bus.js";
import type { EventName, EventPayloadMap } from "@cloudstash/ipc-contracts/sync-service";

import {
  createOAuthLoopbackBroker,
  type OAuthLoopbackBroker,
} from "../loopback-broker.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBusSpy(bus: EventBus): {
  events: Array<{ name: EventName; payload: EventPayloadMap[EventName] }>;
} {
  const events: Array<{ name: EventName; payload: EventPayloadMap[EventName] }> = [];
  bus.subscribe((name, payload) => {
    events.push({ name, payload: payload as EventPayloadMap[EventName] });
  });
  return { events };
}

/** Credential-store stub whose `get(datasourceId)` resolves to a caller-
 *  supplied row (or null). Used to drive the broker's anchor read. */
function makeCredentialStore(
  row: StoredCredentials | null,
): { store: CredentialStore; getSpy: ReturnType<typeof vi.fn> } {
  const getSpy = vi.fn(async () => row);
  const store = {
    get: getSpy,
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  } as unknown as CredentialStore;
  return { store, getSpy };
}

/** Build a stored-credentials row carrying a `meta.account` anchor. */
function rowWithAccount(account: unknown): StoredCredentials {
  return {
    providerId: "google-drive",
    authResult: {
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
      meta: { account },
    },
    createdAt: 1,
    updatedAt: 2,
  };
}

/** Factory whose `createForAuth` records the 5th positional arg
 *  (`expectedAccount`) and whose `completeWith` either resolves with
 *  `authResult` or rejects with `rejectWith`. */
function makeFakeFactory(opts: {
  authResult?: AuthResult;
  rejectWith?: unknown;
}): {
  factory: ClientFactory;
  getExpectedAccountArg: () => unknown;
  createForAuthSpy: ReturnType<typeof vi.fn>;
} {
  const createForAuthSpy = vi.fn(
    (
      _providerId: ProviderId,
      oauthAppConfig: OAuthAppConfig | null,
      _ctx: EngineContext,
      _datasourceId?: string,
      _expectedAccount?: AccountIdentity,
    ) => {
      const redirectUri =
        oauthAppConfig?.redirectUri ?? "http://127.0.0.1:0/callback";
      const completeWith = vi.fn(async (_code: string): Promise<AuthResult> => {
        if (opts.rejectWith !== undefined) {
          throw opts.rejectWith;
        }
        return opts.authResult ?? { accessToken: "tok" };
      });
      const intent: OAuthIntent = {
        kind: "oauth",
        authorizeUrl:
          "https://accounts.google.com/o/oauth2/v2/auth"
          + "?client_id=test-id"
          + "&redirect_uri=" + encodeURIComponent(redirectUri),
        completeWith,
      };
      return {
        authenticate: async () => intent,
      } as unknown as ReturnType<ClientFactory["createForAuth"]>;
    },
  );

  const factory: ClientFactory = {
    create: vi.fn(),
    createForAuth: createForAuthSpy as unknown as ClientFactory["createForAuth"],
  } as unknown as ClientFactory;

  return {
    factory,
    getExpectedAccountArg: () => {
      const call = createForAuthSpy.mock.calls[0];
      if (!call) {
        throw new Error("createForAuth was not called");
      }
      return call[4];
    },
    createForAuthSpy,
  };
}

function makeGetOAuthAppConfig(): (
  providerId: ProviderId,
  redirectUri: string,
) => Promise<OAuthAppConfig> {
  return async (_providerId, redirectUri) => ({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri,
  });
}

/** Drive a real /callback hit with the broker's own state so the deferred
 *  `completeWith` runs. */
async function hitCallback(
  broker: OAuthLoopbackBroker,
  correlationId: string,
): Promise<void> {
  const session = broker._getPendingSessionForTests(correlationId);
  if (!session) throw new Error("no pending session for " + correlationId);
  const { port, state } = session;
  const url =
    "http://127.0.0.1:" + String(port) +
    "/callback?code=valid-code&state=" + encodeURIComponent(state);
  await fetch(url, { signal: AbortSignal.timeout(3000) });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OAuthLoopbackBroker — reconnect account anchor (§7)", () => {
  let broker: OAuthLoopbackBroker | undefined;
  let bus: EventBus;

  beforeEach(() => {
    bus = createEventBus();
  });

  afterEach(() => {
    broker?.dispose();
    broker = undefined;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // §7.1 / 7.2 — anchor read + thread to createForAuth
  // -------------------------------------------------------------------------

  it("reads the stored meta.account and threads it as expectedAccount to createForAuth (reconnect)", async () => {
    const account = { sub: "bound-sub-123", email: "owner@example.com" };
    const { store, getSpy } = makeCredentialStore(rowWithAccount(account));
    const engineContext: EngineContext = { credentialStore: store };
    const { factory, getExpectedAccountArg } = makeFakeFactory({});

    broker = createOAuthLoopbackBroker({
      bus,
      engineContext,
      factory,
      getOAuthAppConfig: makeGetOAuthAppConfig(),
      dataDir: "/tmp/cloudstash-test-data-dir",
    });

    const { correlationId } = await broker.start({
      providerId: "google-drive",
      datasourceId: "ds-existing-1",
    });

    // The store was consulted for THIS datasourceId.
    expect(getSpy).toHaveBeenCalledWith("ds-existing-1");
    // The anchor was threaded as the 5th positional arg verbatim.
    expect(getExpectedAccountArg()).toEqual(account);

    await broker.cancel({ correlationId });
  });

  it("passes no expectedAccount when start() has no datasourceId (first connect — capture only)", async () => {
    const { store, getSpy } = makeCredentialStore(null);
    const engineContext: EngineContext = { credentialStore: store };
    const { factory, getExpectedAccountArg } = makeFakeFactory({});

    broker = createOAuthLoopbackBroker({
      bus,
      engineContext,
      factory,
      getOAuthAppConfig: makeGetOAuthAppConfig(),
      dataDir: "/tmp/cloudstash-test-data-dir",
    });

    const { correlationId } = await broker.start({ providerId: "google-drive" });

    // No datasourceId → the store is never consulted, no anchor threaded.
    expect(getSpy).not.toHaveBeenCalled();
    expect(getExpectedAccountArg()).toBeUndefined();

    await broker.cancel({ correlationId });
  });

  it("passes no expectedAccount when the stored credentials have no meta.account (legacy datasource)", async () => {
    // Pre-upgrade row: authResult.meta carries app-config but no account.
    const legacyRow: StoredCredentials = {
      providerId: "google-drive",
      authResult: {
        accessToken: "stored-access",
        meta: { clientId: "abc", scope: "drive" },
      },
      createdAt: 1,
      updatedAt: 2,
    };
    const { store } = makeCredentialStore(legacyRow);
    const engineContext: EngineContext = { credentialStore: store };
    const { factory, getExpectedAccountArg } = makeFakeFactory({});

    broker = createOAuthLoopbackBroker({
      bus,
      engineContext,
      factory,
      getOAuthAppConfig: makeGetOAuthAppConfig(),
      dataDir: "/tmp/cloudstash-test-data-dir",
    });

    const { correlationId } = await broker.start({
      providerId: "google-drive",
      datasourceId: "ds-legacy-1",
    });

    expect(getExpectedAccountArg()).toBeUndefined();

    await broker.cancel({ correlationId });
  });

  it("passes no expectedAccount when meta.account.sub is empty/missing (sub is the sole comparison key)", async () => {
    // No usable comparison key (email alone cannot anchor) → capture only.
    const { store } = makeCredentialStore(
      rowWithAccount({ sub: "", email: "owner@example.com" }),
    );
    const engineContext: EngineContext = { credentialStore: store };
    const { factory, getExpectedAccountArg } = makeFakeFactory({});

    broker = createOAuthLoopbackBroker({
      bus,
      engineContext,
      factory,
      getOAuthAppConfig: makeGetOAuthAppConfig(),
      dataDir: "/tmp/cloudstash-test-data-dir",
    });

    const { correlationId } = await broker.start({
      providerId: "google-drive",
      datasourceId: "ds-no-sub-1",
    });

    expect(getExpectedAccountArg()).toBeUndefined();

    await broker.cancel({ correlationId });
  });

  it("threads the anchor with email='' when sub is present but email is absent — sub is the sole comparison key (D1; Microsoft/AAD id_tokens may omit email)", async () => {
    // C1 regression: an email-less account (valid sub) MUST still enforce on
    // reconnect. Gating on a non-empty email would silently disable the hard
    // block for the exact in-scope provider (OneDrive/AAD) whose id_token can
    // omit the `email` claim.
    const { store } = makeCredentialStore(
      rowWithAccount({ sub: "bound-sub-no-email" }),
    );
    const engineContext: EngineContext = { credentialStore: store };
    const { factory, getExpectedAccountArg } = makeFakeFactory({});

    broker = createOAuthLoopbackBroker({
      bus,
      engineContext,
      factory,
      getOAuthAppConfig: makeGetOAuthAppConfig(),
      dataDir: "/tmp/cloudstash-test-data-dir",
    });

    const { correlationId } = await broker.start({
      providerId: "google-drive",
      datasourceId: "ds-no-email-1",
    });

    // Anchor IS threaded (enforcement fires on sub); email normalized to "".
    expect(getExpectedAccountArg()).toEqual({
      sub: "bound-sub-no-email",
      email: "",
    });

    await broker.cancel({ correlationId });
  });

  // -------------------------------------------------------------------------
  // §7.3 / 7.4 — account-mismatch → auth-failed mapping
  // -------------------------------------------------------------------------

  it("maps a completeWith account-mismatch rejection to auth-failed{tag:account-mismatch} carrying both emails; emits no credential-persisted/auth-completed", async () => {
    const mismatch = new DatasourceError({
      tag: DatasourceErrorTag.AccountMismatch,
      datasourceType: "google-drive",
      datasourceId: "ds-existing-2",
      retryable: false,
      raw: {
        expectedSub: "bound-sub",
        expectedEmail: "owner@example.com",
        actualSub: "intruder-sub",
        actualEmail: "intruder@example.com",
      },
      message:
        "This datasource is connected to owner@example.com. You signed in as a different account.",
    });
    const account = { sub: "bound-sub", email: "owner@example.com" };
    const { store } = makeCredentialStore(rowWithAccount(account));
    const engineContext: EngineContext = { credentialStore: store };
    const { factory } = makeFakeFactory({ rejectWith: mismatch });
    const { events } = makeBusSpy(bus);

    broker = createOAuthLoopbackBroker({
      bus,
      engineContext,
      factory,
      getOAuthAppConfig: makeGetOAuthAppConfig(),
      dataDir: "/tmp/cloudstash-test-data-dir",
    });

    const { correlationId } = await broker.start({
      providerId: "google-drive",
      datasourceId: "ds-existing-2",
    });
    await hitCallback(broker, correlationId);

    await vi.waitFor(
      () => {
        expect(events.filter((e) => e.name === "auth-failed")).toHaveLength(1);
      },
      { timeout: 2000 },
    );

    const failed = events.find((e) => e.name === "auth-failed");
    const payload = failed!.payload as EventPayloadMap["auth-failed"];
    expect(payload.correlationId).toBe(correlationId);
    expect(payload.tag).toBe("account-mismatch");
    expect(payload.expectedEmail).toBe("owner@example.com");
    expect(payload.actualEmail).toBe("intruder@example.com");
    // message names the bound account (generic fallback string).
    expect(payload.message).toContain("owner@example.com");

    // NO success pair for a hard-blocked reconnect.
    expect(events.filter((e) => e.name === "credential-persisted")).toHaveLength(0);
    expect(events.filter((e) => e.name === "auth-completed")).toHaveLength(0);
  });

  it("keeps mapping non-account-mismatch rejections to provider-error", async () => {
    const otherErr = new Error("network blew up");
    const { store } = makeCredentialStore(
      rowWithAccount({ sub: "bound-sub", email: "owner@example.com" }),
    );
    const engineContext: EngineContext = { credentialStore: store };
    const { factory } = makeFakeFactory({ rejectWith: otherErr });
    const { events } = makeBusSpy(bus);

    broker = createOAuthLoopbackBroker({
      bus,
      engineContext,
      factory,
      getOAuthAppConfig: makeGetOAuthAppConfig(),
      dataDir: "/tmp/cloudstash-test-data-dir",
    });

    const { correlationId } = await broker.start({
      providerId: "google-drive",
      datasourceId: "ds-existing-3",
    });
    await hitCallback(broker, correlationId);

    await vi.waitFor(
      () => {
        expect(events.filter((e) => e.name === "auth-failed")).toHaveLength(1);
      },
      { timeout: 2000 },
    );

    const failed = events.find((e) => e.name === "auth-failed");
    const payload = failed!.payload as EventPayloadMap["auth-failed"];
    expect(payload.tag).toBe("provider-error");
    // provider-error carries no structured emails.
    expect(payload.expectedEmail).toBeUndefined();
    expect(payload.actualEmail).toBeUndefined();
  });

  it("also maps an account-mismatch even with a missing actualEmail (best-effort actual)", async () => {
    const mismatch = new DatasourceError({
      tag: DatasourceErrorTag.AccountMismatch,
      datasourceType: "onedrive",
      datasourceId: "ds-existing-4",
      retryable: false,
      raw: {
        expectedSub: "bound-sub",
        expectedEmail: "owner@contoso.com",
        actualSub: "intruder-sub",
        // actualEmail intentionally absent
      },
      message: "Wrong account",
    });
    const { store } = makeCredentialStore(
      rowWithAccount({ sub: "bound-sub", email: "owner@contoso.com" }),
    );
    const engineContext: EngineContext = { credentialStore: store };
    const { factory } = makeFakeFactory({ rejectWith: mismatch });
    const { events } = makeBusSpy(bus);

    broker = createOAuthLoopbackBroker({
      bus,
      engineContext,
      factory,
      getOAuthAppConfig: makeGetOAuthAppConfig(),
      dataDir: "/tmp/cloudstash-test-data-dir",
    });

    const { correlationId } = await broker.start({
      providerId: "onedrive",
      datasourceId: "ds-existing-4",
    });
    await hitCallback(broker, correlationId);

    await vi.waitFor(
      () => {
        expect(events.filter((e) => e.name === "auth-failed")).toHaveLength(1);
      },
      { timeout: 2000 },
    );

    const failed = events.find((e) => e.name === "auth-failed");
    const payload = failed!.payload as EventPayloadMap["auth-failed"];
    expect(payload.tag).toBe("account-mismatch");
    expect(payload.expectedEmail).toBe("owner@contoso.com");
    expect(payload.actualEmail).toBeUndefined();
  });
});
