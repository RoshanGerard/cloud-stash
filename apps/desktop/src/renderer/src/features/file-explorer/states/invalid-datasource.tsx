"use client";

//
// implement-datasource-onboarding §27 — file-explorer Pattern-A full-replace
// state for a datasource that needs to reconnect.
//
// unify-datasource-reconnect-view generalized this component to serve BOTH the
// `invalid-datasource` AND `auth-revoked` error tags (the amber navigate-away
// AuthRevokedState is retired), and to make Reconnect work for every datasource
// type:
//
//   - OAuth providers (credentialsSchema "oauth"): Reconnect calls
//     sync.authenticateStart directly; the browser opens; useAuthSession drives
//     the Connecting…/failed/timeout states (unchanged behaviour).
//   - Credential-form providers (credentialsSchema "aws-access-key" / "custom"):
//     Reconnect reveals the matching credential form INLINE (below the icon +
//     heading), threaded with the existing datasourceId so the reconnect
//     re-auths the existing datasource. A Back affordance returns to the prompt.
//
// Per design.md Decision 4, providerId is sourced from summary.providerId via
// the parent — NEVER from the engine error (resolveClient emits a placeholder
// providerId when credentials are missing). When providerId is undefined
// (isolation tests), Reconnect is aria-disabled with an explanatory tooltip.
//

import { useCallback, useEffect, useRef, useState } from "react";

import { providers } from "@ft5/ipc-contracts";
import type { ProviderDescriptor, ProviderId } from "@ft5/ipc-contracts";

import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { AwsAccessKeyForm } from "@/features/datasources/credential-forms/aws-access-key-form";
import { CustomForm } from "@/features/datasources/credential-forms/custom-form";
import { useAuthSession } from "@/features/datasources/store";

export interface InvalidDatasourceStateProps {
  /**
   * The provider key (`google-drive`, `onedrive`, `amazon-s3`, ...). Threaded
   * from the route layer via `summary.providerId`. When undefined (test renders
   * the component in isolation), the Reconnect button is disabled with
   * `aria-disabled="true"` and a tooltip explaining the missing context.
   */
  providerId?: string;
  /** The datasource whose credentials need re-registering. */
  datasourceId: string;
  /**
   * Invoked exactly once after a reconnect completes (OAuth session reaches
   * `completed`, or a credential form signals `_authCompleted`). Parent wires
   * this to `store.retryLoad()` so the explorer re-dispatches `files:list`.
   */
  onReconnectSucceeded: () => void;
  /**
   * Invoked when the user clicks "Remove datasource". Parent owns the shared
   * `<ConfirmRemoveDatasourceDialog>`; this component is purely the trigger.
   */
  onRequestRemove: () => void;
  /**
   * fix-insufficient-auth-scopes-recovery: when the initiating files-error
   * envelope carries `authErrorKind: "scope-insufficient"` (a Google Drive
   * runtime insufficient-scope 403, or the proactive scope check), the
   * reconnect view fills its dormant auth-error slot with a destructive-palette
   * callout. Threaded from the store's `authErrorKind` slot via
   * `<InvalidDatasourceArm>`. `null` / `undefined` → no callout (the existing
   * initial / dead-end / account-mismatch copy paths are unchanged).
   */
  authErrorKind?: "scope-insufficient" | null;
  /**
   * The engine error message (the files-error envelope `message`) rendered in
   * the callout's "Authentication error: <message>" detail line. Only consumed
   * when `authErrorKind === "scope-insufficient"`.
   */
  authErrorMessage?: string | null;
}

export function InvalidDatasourceState({
  providerId,
  datasourceId,
  onReconnectSucceeded,
  onRequestRemove,
  authErrorKind,
  authErrorMessage,
}: InvalidDatasourceStateProps) {
  const descriptor =
    providerId !== undefined
      ? (providers as Record<string, ProviderDescriptor>)[providerId]
      : undefined;
  const credentialsSchema = descriptor?.credentialsSchema;
  const providerDisplayName =
    descriptor?.displayName ?? providerId ?? "this datasource";

  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Set true when the user cancels a pending reconnect via the live Cancel
  // control. Drives the dead-end body + "Try Again" primary even though the
  // session was reset to no-active-session (correlationId === null).
  const [cancelledByUser, setCancelledByUser] = useState(false);
  // Pass a sentinel when no session is active so the hook always returns a
  // well-defined `{ status: "pending" }` for the unused slot.
  const sessionState = useAuthSession(correlationId ?? "__none__");

  // Cancel an in-flight reconnect on unmount (mirrors oauth-form.tsx) so that
  // navigating away from — or Removing — the datasource mid-reconnect does not
  // leave a dangling loopback session until the broker's 5-minute timeout. The
  // ref holds the latest correlationId so the empty-deps cleanup sees the live
  // value without re-subscribing every time correlationId changes.
  const correlationIdRef = useRef<string | null>(null);
  useEffect(() => {
    correlationIdRef.current = correlationId;
  }, [correlationId]);
  useEffect(() => {
    return () => {
      const cid = correlationIdRef.current;
      if (cid !== null) {
        // authenticateCancel is idempotent — safe to call after a terminal
        // state.
        void window.api.sync.authenticateCancel({ correlationId: cid });
      }
    };
  }, []);

  const isWaiting =
    correlationId !== null && sessionState.status === "pending";
  const isFailed =
    correlationId !== null &&
    (sessionState.status === "cancelled" ||
      sessionState.status === "failed" ||
      sessionState.status === "timeout");

  // Single-fire guard (OAuth path): when `useAuthSession` reaches "completed",
  // notify the parent exactly once per correlationId.
  const succeededFiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (correlationId === null) return;
    if (sessionState.status !== "completed") return;
    if (succeededFiredFor.current === correlationId) return;
    succeededFiredFor.current = correlationId;
    onReconnectSucceeded();
  }, [correlationId, sessionState, onReconnectSucceeded]);

  const handleReconnect = useCallback(async () => {
    if (providerId === undefined) return;
    if (isWaiting) return;
    setStartError(null);
    setCancelledByUser(false);
    // Credential-form providers reconnect via the inline form (it owns the
    // authenticateStart/Complete flow); reveal it instead of starting OAuth.
    // Gate strictly on a KNOWN form schema: an unrecognised schema (e.g.
    // registry/version skew where providerId isn't in the frozen registry)
    // falls through to authenticateStart and surfaces inline via Decision 5,
    // rather than trapping the user in an escape-less empty form arm.
    if (
      credentialsSchema === "aws-access-key" ||
      credentialsSchema === "custom"
    ) {
      setShowForm(true);
      return;
    }
    const res = await window.api.sync.authenticateStart({
      providerId: providerId as ProviderId,
      datasourceId,
    });
    if (res.ok && res.result.kind === "oauth") {
      setCorrelationId(res.result.correlationId);
    } else if (!res.ok) {
      // Decision 5 — surface the failure inline instead of silently
      // re-enabling the button with no feedback.
      const message =
        "message" in res.error && res.error.message
          ? res.error.message
          : `Reconnect failed (${res.error.tag}).`;
      setStartError(message);
    }
  }, [providerId, datasourceId, isWaiting, credentialsSchema]);

  const handleFormSubmit = useCallback(
    (credentials: Record<string, unknown>) => {
      if (credentials._authCompleted === "completed") {
        onReconnectSucceeded();
      }
    },
    [onReconnectSucceeded],
  );

  const handleFormBack = useCallback(() => {
    setShowForm(false);
  }, []);

  // Live Cancel during a pending reconnect (D1): tear down the service-side
  // session, clear the recorded correlationId (resetting to no-active-session),
  // and flip the view into the recovered dead-end state so the primary returns
  // to an actionable "Try Again".
  const handleCancel = useCallback(() => {
    if (correlationId !== null) {
      void window.api.sync.authenticateCancel({ correlationId });
    }
    setCorrelationId(null);
    setCancelledByUser(true);
    setStartError(null);
  }, [correlationId]);

  const reconnectDisabled = providerId === undefined;

  // enforce-oauth-reconnect-account-match §8 (design.md `## Visual direction`)
  // — a reconnect that authenticated as the WRONG account is hard-blocked
  // upstream and surfaces here as a failed session tagged `account-mismatch`.
  // Narrow explicitly on the failed/`account-mismatch` discriminant (the
  // `isFailed` umbrella also covers `cancelled`/`timeout`, which carry no
  // `tag`/email fields). Copy is assembled from the STRUCTURED fields
  // (`expectedEmail`/`actualEmail`) per D5 — never parsed from `message`.
  const isAccountMismatch =
    sessionState.status === "failed" &&
    // eslint-disable-next-line ft5/no-raw-error-tag-literal -- AuthFailedTag vocabulary (no const object) — out of scope
    sessionState.tag === "account-mismatch";
  const expectedEmail = isAccountMismatch
    ? sessionState.expectedEmail
    : undefined;
  const actualEmail = isAccountMismatch ? sessionState.actualEmail : undefined;

  // account-mismatch is the ONE terminal case that keeps the live "Reconnect"
  // label (its callout already says "Reconnect using {email}", and the shipped
  // enforce-oauth-reconnect-account-match tests pin it to /^reconnect$/i). Every
  // other dead-end — failed (non-mismatch) / timeout / cancelled, or a
  // user-initiated cancel — surfaces the "Try Again" recovery label.
  const showDeadEnd = (isFailed && !isAccountMismatch) || cancelledByUser;
  const primaryLabel = showDeadEnd ? "Try Again" : "Reconnect";

  // fix-insufficient-auth-scopes-recovery: the destructive-palette auth-error
  // callout renders when the initiating files-error envelope tagged the failure
  // `scope-insufficient`. Precedence (one callout / one body-state at a time):
  // an in-progress reconnect (`isWaiting` → the "Connecting…" status line) and a
  // wrong-account session failure (`isAccountMismatch` → the amber callout) both
  // take priority over the stale initiating error's red callout.
  const showAuthError =
    authErrorKind === "scope-insufficient" && !isWaiting && !isAccountMismatch;

  // ---- Credential-form inline arm (keep header, form below) -------------
  if (
    showForm &&
    providerId !== undefined &&
    (credentialsSchema === "aws-access-key" || credentialsSchema === "custom")
  ) {
    const FormComponent =
      credentialsSchema === "aws-access-key" ? AwsAccessKeyForm : CustomForm;
    return (
      <div
        data-testid="file-explorer-state-invalid-datasource"
        role="alert"
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[10px] px-4 py-12"
      >
        <Icon
          name="alert-triangle"
          className="text-destructive"
          width={40}
          height={40}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div className="text-[15px] font-semibold text-foreground">
          Reconnect {providerDisplayName}
        </div>
        <div className="mt-2 w-full max-w-sm">
          <FormComponent
            providerId={providerId}
            providerDisplayName={providerDisplayName}
            datasourceId={datasourceId}
            onSubmit={handleFormSubmit}
            onBack={handleFormBack}
          />
        </div>
      </div>
    );
  }

  // ---- Prompt (default) -------------------------------------------------
  return (
    <div
      data-testid="file-explorer-state-invalid-datasource"
      role="alert"
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[10px] px-4 py-12"
    >
      <Icon
        name="alert-triangle"
        className="text-destructive"
        width={40}
        height={40}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <div className="text-[15px] font-semibold text-foreground">
        This datasource needs reconfiguring
      </div>
      {/* BODY — keyed on session phase (D3 unified message path):            */}
      {/* pending → announced status line; dead-end → honest failure copy;    */}
      {/* scope-insufficient → suppressed (the red callout below explains);    */}
      {/* else → the generic initial/missing-credential copy (default).       */}
      {isWaiting ? (
        <p
          role="status"
          aria-live="polite"
          className="max-w-[320px] text-center text-[13px] text-muted-foreground"
        >
          Connecting… — finish signing in to {providerDisplayName} in your
          browser.
        </p>
      ) : showDeadEnd ? (
        <p className="max-w-[320px] text-center text-[13px] text-destructive">
          Sign-in didn&apos;t complete. Try again with the account this
          datasource is connected to.
        </p>
      ) : showAuthError ? null : ( // credential present but under-scoped — the
        // generic "missing or invalid" line would contradict the callout below.
        <div className="max-w-[320px] text-center text-[13px] text-muted-foreground">
          Its connection details are missing or invalid. Sign in again or remove
          the datasource and add it back.
        </div>
      )}
      <div className="mt-2 flex gap-2">
        {isWaiting ? (
          // Pending: an actionable Cancel REPLACES the primary — there is never
          // a disabled/greyed "Connecting…" button on screen (D1).
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
          >
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            // When `providerId` is missing we keep the button focusable but
            // mark it `aria-disabled` — the tooltip explains the cause. We do
            // NOT use the native `disabled` attribute (that would remove it from
            // the AT tree); the click handler short-circuits instead.
            aria-disabled={reconnectDisabled || undefined}
            title={
              reconnectDisabled
                ? "Provider information unavailable — return to the dashboard to reconnect"
                : undefined
            }
            onClick={() => {
              void handleReconnect();
            }}
          >
            {primaryLabel}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          // Remove stays enabled during pending (D6); the unmount-cancel effect
          // tears down the in-flight session when Remove unmounts the explorer.
          onClick={onRequestRemove}
        >
          Remove datasource
        </Button>
      </div>
      {isAccountMismatch ? (
        // Full amber "Wrong account" callout (below the action buttons),
        // naming BOTH the bound account and the just-signed-in-as account.
        // Amber signals a recoverable correction — red stays reserved for
        // hard errors. Reconnect above stays live for a retry.
        <div
          data-testid="wrong-account-callout"
          className="mt-2 flex w-full max-w-[360px] items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-700 dark:bg-amber-600/13"
        >
          <Icon
            name="alert-triangle"
            className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            width={16}
            height={16}
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-300">
              Wrong account
            </p>
            <p
              data-testid="wrong-account-callout-body"
              className="mt-0.5 text-[12px] text-amber-900 dark:text-amber-200"
            >
              {expectedEmail ? (
                <>
                  This datasource is connected to{" "}
                  <strong className="font-semibold">{expectedEmail}</strong>.
                </>
              ) : (
                // Email-less account (e.g. an AAD id_token with no `email`
                // claim): the block still fires on `sub`, but we have no email
                // to name, so fall back to a generic phrase instead of a blank.
                <>This datasource is connected to a different account.</>
              )}
              {actualEmail ? (
                <>
                  {" "}
                  You signed in as{" "}
                  <strong className="font-semibold">{actualEmail}</strong>.
                </>
              ) : null}{" "}
              Reconnect using{" "}
              {expectedEmail ? (
                <strong className="font-semibold">{expectedEmail}</strong>
              ) : (
                "the originally-connected account"
              )}{" "}
              to continue.
            </p>
          </div>
        </div>
      ) : null}
      {showAuthError ? (
        // fix-insufficient-auth-scopes-recovery — destructive-palette auth-error
        // callout (the red sibling of the amber wrong-account callout, below the
        // action buttons). Provider-parameterized steering headline + a
        // lower-emphasis "Authentication error: <engine message>" detail. The
        // steering headline breaks the granular-consent re-deny loop (it tells
        // the user to grant FULL access on reconnect); the detail preserves the
        // raw provider error. Motion-free; red is reserved for hard auth errors.
        <div
          data-testid="auth-error-callout"
          // Red-keyed sibling of the amber wrong-account callout. Colours mirror
          // that callout's proven WCAG-AA approach: literal palette shades with a
          // light-on-dark / dark-on-light pairing so the TEXT sits on the
          // callout's OWN fixed-shade background (bg-red-50 / dark:bg-red-950),
          // making contrast theme-independent — NOT `text-destructive` on a
          // `bg-destructive/5` tint, which fails AA in the light + serene-blue
          // themes (the page-background tint drops it below 4.5:1). The left
          // accent is the red-keyed flourish.
          className="mt-2 flex w-full max-w-[360px] items-start gap-2 rounded-md border border-red-300 border-l-2 border-l-red-500 bg-red-50 p-3 text-left dark:border-red-800 dark:border-l-red-500 dark:bg-red-950/40"
        >
          <Icon
            name="alert-triangle"
            className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
            width={16}
            height={16}
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-red-800 dark:text-red-300">
              {providerDisplayName} needs full-access permission
            </p>
            <p
              data-testid="auth-error-callout-detail"
              className="mt-0.5 text-[12px] text-red-900 dark:text-red-200"
            >
              Authentication error:{" "}
              {authErrorMessage ?? "insufficient permissions for this datasource"}
            </p>
          </div>
        </div>
      ) : null}
      {startError !== null ? (
        <p className="text-[12px] text-destructive">{startError}</p>
      ) : null}
    </div>
  );
}
