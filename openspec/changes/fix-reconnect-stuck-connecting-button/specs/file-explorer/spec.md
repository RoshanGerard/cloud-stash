## MODIFIED Requirements

### Requirement: Datasource reconnect runs in-place via `sync.authenticateStart` and refreshes on completion

The shared `<InvalidDatasourceState>` component (rendered for BOTH the `auth-revoked` and `invalid-datasource` error tags) SHALL drive reconnect in place and SHALL NOT route the user back to the dashboard at any point — the reconnect lifecycle stays inside the file-explorer view.

The `Reconnect` button SHALL dispatch on the datasource provider's `credentialsSchema` (resolved from the frozen `providers` registry via `providers[providerId]`), with NO `providerId === "..."` branches:

- For OAuth providers (`credentialsSchema === "oauth"`), the button SHALL call `window.api.sync.authenticateStart({ providerId, datasourceId })` directly, capture the returned `correlationId`, and subscribe via the `useAuthSession(correlationId)` hook. While the session status is `pending`, the component SHALL surface "Connecting…" as an **announced status line** (e.g. "Connecting… — finish signing in to {Provider} in your browser.", `role="status"` `aria-live="polite"`, no animated spinner — `animate-spin` is forbidden in feature code by the `scripts/motion-budget.test.ts` guardrail), and the button row SHALL present an actionable **Cancel** control (`variant="outline"`) alongside the Remove button. There SHALL be NO disabled / greyed primary button on screen during `pending`. Activating Cancel calls `window.api.sync.authenticateCancel({ correlationId })`, clears the recorded `correlationId` (resetting to no-active-session), and returns the primary action to an actionable **"Try Again"**. This guarantees that a reconnect which never completes — e.g. a provider dead-end that returns no loopback callback, leaving the session `pending` until the broker's 5-minute `auth-timeout` fires — never strands the user on a disabled "Connecting…" button. The Remove button SHALL remain enabled during `pending`; to keep that safe, the component SHALL cancel its in-flight session on unmount — when it unmounts while a `correlationId` is live, it SHALL call `window.api.sync.authenticateCancel({ correlationId })` (idempotent), so navigating away from, or removing, the datasource mid-reconnect does not leave a dangling loopback session. On session status `completed` the component SHALL invoke its parent's `onReconnectSucceeded` callback (which the file-explorer wires to `store.retryLoad()` so `useExplorerData` re-dispatches `files:list`); on a successful subsequent list the explorer naturally transitions out of the state. On session status `cancelled` / `failed` / `timeout`, the primary action SHALL re-enable with the label **"Try Again"** (NOT "Reconnect") and the Remove button SHALL re-enable; the inline copy SHALL be accurate to the outcome and SHALL NOT present the blanket "Its connection details are missing or invalid" line as the explanation for a failed reconnect attempt. For a dead-end / cancelled / timed-out attempt with no specific cause, the inline copy SHALL read "Sign-in didn't complete. Try again with the account this datasource is connected to." The account-mismatch amber "Wrong account" callout (sourced from the auth-session `tag`, not the files envelope) SHALL continue to render unchanged for the `account-mismatch` case. The inline message region SHALL be a single rendering slot that a sibling change MAY extend with an auth-error headline + detail without re-plumbing. The generic "Its connection details are missing or invalid" body that the "Non-usable datasource states render as pattern-A full-replace treatments" requirement specifies for the initial (pre-attempt) render is the default/initial copy; it is SUPERSEDED by the accurate outcome copy above during and after a reconnect attempt.
- For non-OAuth providers (`credentialsSchema !== "oauth"`), the button SHALL reveal the inline credential form (see the credential-form reconnect requirement) rather than calling `authenticateStart` directly.

When `window.api.sync.authenticateStart` resolves with `{ ok: false, error }` (e.g. `service-config-missing` / `engine-error`), the component SHALL surface inline error copy rather than silently re-enabling the button with no feedback.

The `providerId: string` value SHALL be sourced from the route layer's `summary.providerId` (threaded through a `providerId?: string` prop on `<FileExplorer>`), NEVER from the engine error (the service-side `resolveClient` emits a placeholder `providerId` when credentials are missing). When `providerId` is unavailable (e.g. a test renders the component in isolation without it), the Reconnect button SHALL be `aria-disabled="true"` with a tooltip "Provider information unavailable — return to the dashboard to reconnect", and clicking it SHALL NOT invoke `authenticateStart`.

#### Scenario: auth-revoked tag routes to the shared in-place reconnect, not the dashboard

- **WHEN** `window.api.files.list` rejects with `{ error: { tag: "auth-revoked" } }`, the explorer renders the shared `<InvalidDatasourceState>`, and the user clicks Reconnect for an OAuth datasource `{ providerId: "onedrive", datasourceId: "ds-1" }`
- **THEN** `window.api.sync.authenticateStart({ providerId: "onedrive", datasourceId: "ds-1" })` is called exactly once; the renderer does NOT call `router.push("/")` and does NOT navigate away from the explorer

#### Scenario: OAuth Reconnect starts a scoped session and shows a status line + actionable Cancel during pending (no disabled button)

- **WHEN** a test renders the shared state with `providerId="google-drive" datasourceId="ds-1"`, clicks the Reconnect button, and `window.api.sync.authenticateStart` resolves with `{ ok: true, result: { correlationId: "corr-1", kind: "oauth" } }`
- **THEN** `authenticateStart` is called exactly once with `{ providerId: "google-drive", datasourceId: "ds-1" }`, the `correlationId` is recorded, a "Connecting…" status line is rendered inside a `role="status"` region, the button row presents an enabled **Cancel** control alongside Remove, and NO disabled (or `aria-disabled="true"`) primary "Connecting…" button is present

#### Scenario: Live Cancel during a pending reconnect resets to Try Again

- **WHEN** a reconnect is pending (`authenticateStart` resolved with `correlationId: "corr-1"` and `useAuthSession` reports `status === "pending"`) and the user activates the live Cancel control
- **THEN** `window.api.sync.authenticateCancel({ correlationId: "corr-1" })` is called exactly once, the recorded `correlationId` is cleared, the primary action button re-enables with the visible label "Try Again", and the Remove button re-enables; no navigation occurs and `onReconnectSucceeded` is NOT invoked

#### Scenario: Unmounting during a pending reconnect cancels the in-flight session

- **WHEN** a reconnect is pending (`correlationId: "corr-1"` recorded, `useAuthSession` reports `status === "pending"`) and the component unmounts — e.g. the user clicks the (enabled) Remove button or navigates away from the explorer
- **THEN** `window.api.sync.authenticateCancel({ correlationId: "corr-1" })` is called exactly once during cleanup, so no loopback session is left dangling until the broker's 5-minute timeout

#### Scenario: Successful authenticate triggers `onReconnectSucceeded` callback

- **WHEN** the `useAuthSession` session reaches `status === "completed"`
- **THEN** the component's `onReconnectSucceeded()` prop is invoked exactly once; the parent (file-explorer) wires this to `store.retryLoad()`, which re-dispatches `files:list`

#### Scenario: Cancelled / failed / timeout re-enables the buttons with a Try Again label and accurate copy

- **WHEN** the session reaches `status === "cancelled"` (or `"failed"` / `"timeout"`) with no specific cause (i.e. not `account-mismatch`)
- **THEN** both the primary action and Remove buttons re-enable, the primary action button's visible label reads "Try Again" (NOT "Reconnect"), and an inline message accurate to the outcome renders below the buttons — "Sign-in didn't complete. Try again with the account this datasource is connected to." — NOT the blanket "Its connection details are missing or invalid" line as the failure explanation; clicking "Try Again" starts a fresh `authenticateStart` flow

#### Scenario: account-mismatch failure renders the amber Wrong-account callout unchanged

- **WHEN** the session reaches `status === "failed"` with `tag === "account-mismatch"` (the reconnect authenticated as a different account)
- **THEN** the amber "Wrong account" callout renders unchanged (naming the bound account and the just-signed-in account per its existing behavior), the primary action stays live so the user can retry as the correct account, and the generic dead-end copy ("Sign-in didn't complete…") is NOT shown for this case

#### Scenario: authenticateStart failure surfaces inline rather than silently re-enabling

- **WHEN** the user clicks Reconnect and `window.api.sync.authenticateStart` resolves with `{ ok: false, error: { tag: "service-config-missing", path, providerId } }`
- **THEN** the component renders inline error copy referencing the failure (not a silent button re-enable with no message); the primary action button is usable again so the user can retry

#### Scenario: Reconnect button is disabled when providerId is unavailable

- **WHEN** a test renders the shared state with `datasourceId="ds-1"` but WITHOUT the `providerId` prop
- **THEN** the Reconnect button has `aria-disabled="true"`, its tooltip reads "Provider information unavailable — return to the dashboard to reconnect", and clicking it does NOT invoke `authenticateStart`
