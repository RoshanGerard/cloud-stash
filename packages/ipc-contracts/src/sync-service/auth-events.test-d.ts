// Wire contract for the `auth-*` event taxonomy added by the
// `implement-datasource-onboarding` change (design.md Decision 7).
//
// The service event stream gains seven new variants:
//
// * `auth-initiated` — the only renderer-visible "we just kicked off"
//   notification; carries the correlationId, providerId, and the
//   datasourceId for reconnect flows.
// * `auth-completed` — the user-facing terminal event the renderer
//   consumes for UI updates (dialog close, dashboard refresh).
// * `auth-cancelled` — fired exactly once per active correlation when
//   `sync:authenticate-cancel` consumes a live correlation (or the
//   loopback timer + cancel race resolves to cancel).
// * `auth-failed` — fired on the loopback `state` mismatch, on a
//   `completeWith` rejection, or on engine errors during `submit`.
// * `auth-timeout` — fired on the 5-minute loopback timer.
// * `oauth-open-url` — bridge-only event consumed by desktop main's
//   sync event-bridge to call `shell.openExternal(authorizeUrl)`. The
//   renderer SHALL NEVER receive this event.
// * `credential-persisted` — bridge-only event consumed by desktop
//   main's sync event-bridge to call `getEngine().registry.add(summary)`.
//   The renderer SHALL NEVER receive this event.
//
// `auth-completed` and `credential-persisted` carry overlapping data; their
// distinct identities exist so the bridge can filter the bridge-only
// variants out of the renderer-bound forward.

import { describe, expectTypeOf, it } from "vitest";

import type { DatasourceSummary, ProviderId } from "../datasources.js";
import type {
  AuthCancelledPayload,
  AuthCompletedPayload,
  AuthFailedPayload,
  AuthFailedTag,
  AuthInitiatedPayload,
  AuthTimeoutPayload,
  CredentialPersistedPayload,
  EVENT_NAMES,
  EventName,
  EventPayloadMap,
  OAuthOpenUrlPayload,
  ServiceEvent,
} from "./events.js";

describe("sync-service auth-* event taxonomy — implement-datasource-onboarding", () => {
  it("EventName union contains every auth-* + bridge-only variant", () => {
    type AuthFamily =
      | "auth-initiated"
      | "auth-completed"
      | "auth-cancelled"
      | "auth-failed"
      | "auth-timeout"
      | "oauth-open-url"
      | "credential-persisted";
    expectTypeOf<AuthFamily>().toMatchTypeOf<EventName>();
  });

  it("auth-initiated payload is { correlationId, providerId, datasourceId? }", () => {
    expectTypeOf<AuthInitiatedPayload>().toEqualTypeOf<{
      readonly correlationId: string;
      readonly providerId: ProviderId;
      readonly datasourceId?: string;
    }>();
    expectTypeOf<EventPayloadMap["auth-initiated"]>().toEqualTypeOf<AuthInitiatedPayload>();
  });

  it("auth-completed payload is { correlationId, datasourceId, summary }", () => {
    expectTypeOf<AuthCompletedPayload>().toEqualTypeOf<{
      readonly correlationId: string;
      readonly datasourceId: string;
      readonly summary: DatasourceSummary;
    }>();
    expectTypeOf<EventPayloadMap["auth-completed"]>().toEqualTypeOf<AuthCompletedPayload>();
  });

  it("auth-cancelled payload is { correlationId }", () => {
    expectTypeOf<AuthCancelledPayload>().toEqualTypeOf<{
      readonly correlationId: string;
    }>();
    expectTypeOf<EventPayloadMap["auth-cancelled"]>().toEqualTypeOf<AuthCancelledPayload>();
  });

  it("auth-failed payload is { correlationId, tag, message?, expectedEmail?, actualEmail? }", () => {
    // enforce-oauth-reconnect-account-match D5: the account-mismatch tag
    // carries the bound account email (`expectedEmail`, always present for
    // that tag) plus the just-signed-in-as email (`actualEmail`, optional).
    // Both are OPTIONAL on the shared payload — every other tag omits them.
    expectTypeOf<AuthFailedPayload>().toEqualTypeOf<{
      readonly correlationId: string;
      readonly tag: AuthFailedTag;
      readonly message?: string;
      readonly expectedEmail?: string;
      readonly actualEmail?: string;
    }>();
    expectTypeOf<EventPayloadMap["auth-failed"]>().toEqualTypeOf<AuthFailedPayload>();
  });

  it("auth-failed payload exposes optional account-mismatch email fields", () => {
    // Explicit member checks — `toEqualTypeOf` treats extra optional members
    // as equal, so assert the fields concretely exist and are `string?`.
    expectTypeOf<AuthFailedPayload>().toHaveProperty("expectedEmail");
    expectTypeOf<AuthFailedPayload>().toHaveProperty("actualEmail");
    expectTypeOf<AuthFailedPayload["expectedEmail"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<AuthFailedPayload["actualEmail"]>().toEqualTypeOf<string | undefined>();
  });

  it("AuthFailedTag union contains at least auth-revoked + provider-error", () => {
    expectTypeOf<"auth-revoked">().toMatchTypeOf<AuthFailedTag>();
    expectTypeOf<"provider-error">().toMatchTypeOf<AuthFailedTag>();
  });

  it("AuthFailedTag union admits account-mismatch (reconnect wrong-account)", () => {
    expectTypeOf<"account-mismatch">().toMatchTypeOf<AuthFailedTag>();
  });

  it("auth-timeout payload is { correlationId }", () => {
    expectTypeOf<AuthTimeoutPayload>().toEqualTypeOf<{
      readonly correlationId: string;
    }>();
    expectTypeOf<EventPayloadMap["auth-timeout"]>().toEqualTypeOf<AuthTimeoutPayload>();
  });

  it("oauth-open-url payload is { correlationId, authorizeUrl }", () => {
    expectTypeOf<OAuthOpenUrlPayload>().toEqualTypeOf<{
      readonly correlationId: string;
      readonly authorizeUrl: string;
    }>();
    expectTypeOf<EventPayloadMap["oauth-open-url"]>().toEqualTypeOf<OAuthOpenUrlPayload>();
  });

  it("credential-persisted payload is { correlationId, datasourceId, summary }", () => {
    expectTypeOf<CredentialPersistedPayload>().toEqualTypeOf<{
      readonly correlationId: string;
      readonly datasourceId: string;
      readonly summary: DatasourceSummary;
    }>();
    expectTypeOf<
      EventPayloadMap["credential-persisted"]
    >().toEqualTypeOf<CredentialPersistedPayload>();
  });

  it("ServiceEvent narrows correctly under switch on `name` for new variants", () => {
    type AuthInitiatedEvent = Extract<ServiceEvent, { name: "auth-initiated" }>;
    expectTypeOf<AuthInitiatedEvent>().toEqualTypeOf<{
      readonly name: "auth-initiated";
      readonly payload: AuthInitiatedPayload;
    }>();

    type OAuthOpenUrlEvent = Extract<ServiceEvent, { name: "oauth-open-url" }>;
    expectTypeOf<OAuthOpenUrlEvent>().toEqualTypeOf<{
      readonly name: "oauth-open-url";
      readonly payload: OAuthOpenUrlPayload;
    }>();
  });

  it("EVENT_NAMES tuple contains every new auth-* + bridge-only entry", () => {
    expectTypeOf<(typeof EVENT_NAMES)[number]>().toEqualTypeOf<EventName>();
  });
});
