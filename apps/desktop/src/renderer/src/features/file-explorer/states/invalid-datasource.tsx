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
}

export function InvalidDatasourceState({
  providerId,
  datasourceId,
  onReconnectSucceeded,
  onRequestRemove,
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
  // Pass a sentinel when no session is active so the hook always returns a
  // well-defined `{ status: "pending" }` for the unused slot.
  const sessionState = useAuthSession(correlationId ?? "__none__");

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

  const reconnectDisabled = providerId === undefined;
  const reconnectLabel = isWaiting ? "Connecting…" : "Reconnect";

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
      <div className="max-w-[320px] text-center text-[13px] text-muted-foreground">
        Its connection details are missing or invalid. Sign in again or remove
        the datasource and add it back.
      </div>
      <div className="mt-2 flex gap-2">
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
          disabled={isWaiting}
          onClick={() => {
            void handleReconnect();
          }}
        >
          {reconnectLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={isWaiting}
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
      ) : isFailed ? (
        <p className="text-[12px] text-destructive">
          Reconnect failed — please try again.
        </p>
      ) : null}
      {startError !== null ? (
        <p className="text-[12px] text-destructive">{startError}</p>
      ) : null}
    </div>
  );
}
