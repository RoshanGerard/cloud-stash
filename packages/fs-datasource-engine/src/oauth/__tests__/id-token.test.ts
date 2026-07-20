// enforce-oauth-reconnect-account-match §4.7 — shared `id_token`
// parse/validate helper.
//
// The helper is provider-agnostic: it decodes an OIDC `id_token` JWT
// returned directly by the provider token endpoint over TLS (in response to
// our own authenticated code exchange — NOT via the browser), so it does
// payload decode + claim validation WITHOUT signature verification (see
// design.md Decision D2). The Google Drive and OneDrive strategies each call
// `parseIdToken(...)` after a token exchange and wrap any `IdTokenError` into
// a retryable `DatasourceError` for fail-closed (D7) — that wrapping is the
// provider strategies' job, not this helper's.
//
// Coverage:
//   - valid token → { sub, email }
//   - aud mismatch (string and array forms) → throws
//   - iss not in issuers → throws
//   - expired (outside the 60s skew window) → throws
//   - missing/empty sub → throws
//   - malformed input (not 3 segments / bad base64 / bad JSON) → throws
//   - email absent → email === ""
//   - exp comparison is in seconds vs ms (a token expiring "now" but within
//     the 60s clock-skew grace is still accepted; one comfortably past it is
//     rejected).

import { describe, expect, it } from "vitest";

import { IdTokenError, parseIdToken } from "../id-token.js";

// ---------------------------------------------------------------------------
// Tiny local base64url-JWT builder (header.payload.sig, dummy sig).
// ---------------------------------------------------------------------------

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

/**
 * Build a `header.payload.signature` JWT string. The signature segment is a
 * dummy constant — the helper never verifies it (D2).
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const body = b64url(payload);
  return `${header}.${body}.ZHVtbXktc2ln`;
}

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const ISSUER = "https://accounts.google.com";
const ISSUERS = [ISSUER, "https://login.microsoftonline.com/common/v2.0"];

// A fixed "now" so expiry math is deterministic. Seconds: NOW_MS / 1000.
const NOW_MS = 1_700_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: "1234567890",
    email: "alice@example.com",
    aud: CLIENT_ID,
    iss: ISSUER,
    // Comfortably in the future (1 hour) so skew direction can't flip it.
    exp: NOW_S + 3600,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("parseIdToken — valid token", () => {
  it("extracts { sub, email } from a well-formed id_token", () => {
    const token = makeJwt(validPayload());
    const identity = parseIdToken(token, {
      clientId: CLIENT_ID,
      issuers: ISSUERS,
      now: NOW_MS,
    });
    expect(identity).toEqual({ sub: "1234567890", email: "alice@example.com" });
  });

  it("accepts aud when it is an array containing clientId", () => {
    const token = makeJwt(validPayload({ aud: ["someone-else", CLIENT_ID, "third"] }));
    const identity = parseIdToken(token, {
      clientId: CLIENT_ID,
      issuers: ISSUERS,
      now: NOW_MS,
    });
    expect(identity.sub).toBe("1234567890");
  });

  it('defaults email to "" when the claim is absent (email is display-only)', () => {
    const payload = validPayload();
    delete payload.email;
    const token = makeJwt(payload);
    const identity = parseIdToken(token, {
      clientId: CLIENT_ID,
      issuers: ISSUERS,
      now: NOW_MS,
    });
    expect(identity).toEqual({ sub: "1234567890", email: "" });
  });

  it("accepts a token whose exp is just past now but inside the 60s skew grace", () => {
    // exp 30s in the past — still valid because of the clock-skew allowance.
    const token = makeJwt(validPayload({ exp: NOW_S - 30 }));
    const identity = parseIdToken(token, {
      clientId: CLIENT_ID,
      issuers: ISSUERS,
      now: NOW_MS,
    });
    expect(identity.sub).toBe("1234567890");
  });
});

// ---------------------------------------------------------------------------
// Rejection arms
// ---------------------------------------------------------------------------

describe("parseIdToken — rejection", () => {
  it("throws IdTokenError(bad-aud) when aud is a mismatched string", () => {
    const token = makeJwt(validPayload({ aud: "some-other-client" }));
    let caught: unknown;
    try {
      parseIdToken(token, {
        clientId: CLIENT_ID,
        issuers: ISSUERS,
        now: NOW_MS,
      });
      throw new Error("expected throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IdTokenError);
    expect((caught as IdTokenError).reason).toBe("bad-aud");
  });

  it("throws IdTokenError(bad-aud) when aud is an array NOT containing clientId", () => {
    const token = makeJwt(validPayload({ aud: ["a", "b", "c"] }));
    let caught: unknown;
    try {
      parseIdToken(token, {
        clientId: CLIENT_ID,
        issuers: ISSUERS,
        now: NOW_MS,
      });
      throw new Error("expected throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IdTokenError);
    expect((caught as IdTokenError).reason).toBe("bad-aud");
  });

  it("throws IdTokenError(bad-iss) when iss is not one of the accepted issuers", () => {
    const token = makeJwt(validPayload({ iss: "https://evil.example.com" }));
    let caught: unknown;
    try {
      parseIdToken(token, {
        clientId: CLIENT_ID,
        issuers: ISSUERS,
        now: NOW_MS,
      });
      throw new Error("expected throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IdTokenError);
    expect((caught as IdTokenError).reason).toBe("bad-iss");
  });

  it("throws IdTokenError(expired) when exp is comfortably in the past", () => {
    // 1 hour in the past — well outside the 60s skew grace.
    const token = makeJwt(validPayload({ exp: NOW_S - 3600 }));
    let caught: unknown;
    try {
      parseIdToken(token, {
        clientId: CLIENT_ID,
        issuers: ISSUERS,
        now: NOW_MS,
      });
      throw new Error("expected throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IdTokenError);
    expect((caught as IdTokenError).reason).toBe("expired");
  });

  it("throws IdTokenError(missing-sub) when sub is absent", () => {
    const payload = validPayload();
    delete payload.sub;
    const token = makeJwt(payload);
    let caught: unknown;
    try {
      parseIdToken(token, {
        clientId: CLIENT_ID,
        issuers: ISSUERS,
        now: NOW_MS,
      });
      throw new Error("expected throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IdTokenError);
    expect((caught as IdTokenError).reason).toBe("missing-sub");
  });

  it("throws IdTokenError(missing-sub) when sub is an empty string", () => {
    const token = makeJwt(validPayload({ sub: "" }));
    let caught: unknown;
    try {
      parseIdToken(token, {
        clientId: CLIENT_ID,
        issuers: ISSUERS,
        now: NOW_MS,
      });
      throw new Error("expected throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IdTokenError);
    expect((caught as IdTokenError).reason).toBe("missing-sub");
  });

  it("throws IdTokenError(malformed) when the token does not have 3 segments", () => {
    let caught: unknown;
    try {
      parseIdToken("only.two", {
        clientId: CLIENT_ID,
        issuers: ISSUERS,
        now: NOW_MS,
      });
      throw new Error("expected throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IdTokenError);
    expect((caught as IdTokenError).reason).toBe("malformed");
  });

  it("throws IdTokenError(malformed) when the payload segment is not valid JSON", () => {
    const header = b64url({ alg: "RS256", typ: "JWT" });
    const badPayload = Buffer.from("not-json{", "utf8").toString("base64url");
    const token = `${header}.${badPayload}.ZHVtbXktc2ln`;
    let caught: unknown;
    try {
      parseIdToken(token, {
        clientId: CLIENT_ID,
        issuers: ISSUERS,
        now: NOW_MS,
      });
      throw new Error("expected throw");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IdTokenError);
    expect((caught as IdTokenError).reason).toBe("malformed");
  });

  it("defaults `now` to Date.now() when not provided (a far-future token still validates)", () => {
    // exp is ~year 2200 so this passes regardless of the wall clock.
    const token = makeJwt(validPayload({ exp: 7_258_118_400 }));
    const identity = parseIdToken(token, {
      clientId: CLIENT_ID,
      issuers: ISSUERS,
    });
    expect(identity.sub).toBe("1234567890");
  });
});
