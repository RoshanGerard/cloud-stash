// Shared, provider-agnostic OIDC `id_token` parse + validate helper.
//
// enforce-oauth-reconnect-account-match Decision D2: identity comes from the
// `id_token` (a JWT) returned by the provider token endpoint. That token
// arrives **directly from the provider over TLS** in response to our own
// authenticated authorization-code exchange — NOT via the browser — so a
// payload decode plus claim validation (`aud` / `iss` / `exp`) is sufficient
// trust; no signature-verification dependency is introduced.
//
// This helper is intentionally pure and provider-neutral:
//   - It does NOT throw `DatasourceError` (that type is provider/engine
//     vocabulary). On ANY failure it throws `IdTokenError`, which carries an
//     enumerated `reason`. The Google Drive and OneDrive strategies catch
//     `IdTokenError` and wrap it into a **retryable** `DatasourceError` so a
//     swap can never slip through on an unreadable identity (fail-closed, D7).
//     That wrapping is the strategies' job, not this helper's.
//   - `now` is injectable for deterministic tests; production passes nothing
//     and it defaults to `Date.now()` (Node runtime).
//
// `sub` is the durable identity key (the reconnect same-account comparison
// keys on it — D1); `email` is display-only and defaults to "" when absent.

import type { AccountIdentity } from "@cloudstash/ipc-contracts";

/** Clock-skew grace applied to `exp` so a token expiring right at the edge of
 *  the exchange is still accepted (the exchange completed moments before).
 *  Lenient direction only: a token is valid while `exp` plus this grace is
 *  still in the future. */
const CLOCK_SKEW_MS = 60_000;

/**
 * Enumerated cause of an `id_token` validation failure. Callers (and the
 * helper's own unit tests) discriminate on this. `"malformed"` covers any
 * structural decode failure (wrong segment count, bad base64url, non-JSON
 * payload, or a payload that is not a JSON object).
 */
export type IdTokenErrorReason =
  | "malformed"
  | "bad-aud"
  | "bad-iss"
  | "expired"
  | "missing-sub";

/**
 * Thrown by `parseIdToken` on any decode or claim-validation failure.
 * Deliberately NOT a `DatasourceError` — this helper is provider-agnostic;
 * strategies translate it into a retryable `DatasourceError` at their layer.
 */
export class IdTokenError extends Error {
  readonly reason: IdTokenErrorReason;

  constructor(reason: IdTokenErrorReason, message: string) {
    super(message);
    this.name = "IdTokenError";
    this.reason = reason;
    // Preserve the prototype chain across the TS/ES class-extends-Error gap so
    // `instanceof IdTokenError` holds for callers.
    Object.setPrototypeOf(this, IdTokenError.prototype);
  }
}

export interface ParseIdTokenOptions {
  /** Our OAuth client id — the token's `aud` MUST equal this (string form) or
   *  include it (array form). */
  clientId: string;
  /** Accepted issuer URLs — the token's `iss` MUST be one of these. */
  issuers: string[];
  /** Injectable "now" in MILLISECONDS (epoch). Defaults to `Date.now()`. */
  now?: number;
}

/** Shape we read off the decoded JWT payload. All claims are validated below;
 *  the type only narrows enough to inspect them. */
interface IdTokenClaims {
  sub?: unknown;
  email?: unknown;
  aud?: unknown;
  iss?: unknown;
  exp?: unknown;
}

/**
 * Decode and validate an OIDC `id_token`, returning the bound
 * `AccountIdentity` (`{ sub, email }`).
 *
 * Validation:
 *   - exactly three `.`-separated segments (else `malformed`);
 *   - middle segment base64url-decodes and JSON-parses to an object (else
 *     `malformed`);
 *   - `aud` equals `clientId` (string) OR includes it (array) — else
 *     `bad-aud`;
 *   - `iss` is one of `issuers` — else `bad-iss`;
 *   - `exp` (NumericDate, SECONDS) is in the future relative to `now ??
 *     Date.now()` (MILLISECONDS) with a 60s skew grace — else `expired`;
 *   - `sub` is a non-empty string — else `missing-sub`.
 *
 * `email` is optional: present string → used as-is; absent/non-string → "".
 *
 * @throws IdTokenError on any failure (carries an enumerated `reason`).
 */
export function parseIdToken(
  idToken: string,
  opts: ParseIdTokenOptions,
): AccountIdentity {
  const segments = idToken.split(".");
  // Bind the payload segment explicitly. The `!== 3` length guard alone does
  // not refine tuple-index access under `noUncheckedIndexedAccess`, so the
  // `undefined` check keeps `payloadSegment` a plain `string` for Buffer.from.
  const [, payloadSegment] = segments;
  if (segments.length !== 3 || payloadSegment === undefined) {
    throw new IdTokenError(
      "malformed",
      `id_token must have 3 dot-separated segments, got ${segments.length}`,
    );
  }

  let claims: IdTokenClaims;
  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("payload is not a JSON object");
    }
    claims = parsed as IdTokenClaims;
  } catch (err) {
    throw new IdTokenError(
      "malformed",
      `id_token payload could not be decoded: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // aud — string-equal OR array-includes.
  const { aud } = claims;
  const audMatches =
    aud === opts.clientId ||
    (Array.isArray(aud) && aud.includes(opts.clientId));
  if (!audMatches) {
    throw new IdTokenError(
      "bad-aud",
      `id_token aud does not match expected client id '${opts.clientId}'`,
    );
  }

  // iss — must be one of the accepted issuers.
  const { iss } = claims;
  if (typeof iss !== "string" || !opts.issuers.includes(iss)) {
    throw new IdTokenError(
      "bad-iss",
      `id_token iss '${String(iss)}' is not an accepted issuer`,
    );
  }

  // exp — NumericDate in SECONDS; compare against `now` in MILLISECONDS with a
  // lenient clock-skew grace (valid while exp*1000 + skew is still future).
  const { exp } = claims;
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new IdTokenError(
      "expired",
      "id_token is missing a numeric exp claim",
    );
  }
  const nowMs = opts.now ?? Date.now();
  if (exp * 1000 + CLOCK_SKEW_MS <= nowMs) {
    throw new IdTokenError("expired", "id_token has expired");
  }

  // sub — durable identity key; MUST be a non-empty string.
  const { sub } = claims;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new IdTokenError(
      "missing-sub",
      "id_token is missing a non-empty sub claim",
    );
  }

  // email — display-only; default to "" when absent or non-string.
  const email = typeof claims.email === "string" ? claims.email : "";

  return { sub, email };
}
