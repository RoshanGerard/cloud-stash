## 1. Reactive TDD — failing tests first

- [x] 1.1 In `apps/desktop/src/renderer/src/features/file-explorer/states/__tests__/invalid-datasource.test.tsx`, add a failing test: while a reconnect is `pending`, a "Connecting…" status line renders inside a `role="status"` region and the button row shows an enabled **Cancel** control with NO disabled/greyed primary button present; activating Cancel calls `window.api.sync.authenticateCancel({ correlationId })` exactly once, clears the recorded `correlationId`, sets the primary action to **"Try Again"**, and keeps Remove available (no navigation, `onReconnectSucceeded` NOT called).
- [x] 1.2 Add a failing test: on terminal `cancelled` / `failed` / `timeout` with no specific cause, the primary action label reads **"Try Again"** (NOT "Reconnect") and the inline copy is the accurate dead-end line "Sign-in didn't complete. Try again with the account this datasource is connected to." — NOT the blanket "Its connection details are missing or invalid" as the failure explanation.
- [x] 1.3 Add a non-regression failing test: on `failed` with `tag === "account-mismatch"`, the amber "Wrong account" callout still renders unchanged, the primary action stays live, and the generic dead-end copy is NOT shown.
- [x] 1.4 Add a failing test: unmounting the component while a reconnect is `pending` (a live `correlationId`) calls `window.api.sync.authenticateCancel({ correlationId })` exactly once during cleanup (so Remove-during-pending / navigate-away leaves no dangling session).
- [x] 1.5 Run the suite and watch 1.1–1.4 fail for the right reason (current code has no Cancel control, no unmount-cancel, and re-labels to "Reconnect").

## 2. Implement reconnect-view recovery (`states/invalid-datasource.tsx`)

- [x] 2.1 Replace the disabled "Connecting…" primary (while `isWaiting`/session `pending`) with a "Connecting…" **status line** (`role="status"` `aria-live="polite"`, no spinner) plus an actionable outline **Cancel** control; on Cancel click, call `window.api.sync.authenticateCancel({ correlationId })`, set `correlationId` to `null`, and reset `startError`/local state so the primary action returns to an actionable state. No disabled/greyed primary button during pending.
- [x] 2.2 Change the terminal-state label logic so a `cancelled` / `failed` / `timeout` session yields a primary button labelled **"Try Again"** (not "Reconnect"); keep the disabled "Connecting…" label only while `pending`.
- [x] 2.3 Replace the blanket failure explanation: for a terminal failure with no specific cause, render the accurate dead-end copy; ensure the static "Its connection details are missing or invalid" body is NOT presented as the failed-reconnect explanation (initial pre-attempt render of that copy for a genuine missing-credential state is unchanged).
- [x] 2.4 Leave the `account-mismatch` amber callout branch structurally intact (sourced from the auth-session `tag`), verifying 1.3 stays green.
- [x] 2.5 Factor the inline message region into a single rendering slot that the sibling change `fix-insufficient-auth-scopes-recovery` can extend with an auth-error headline + detail — no new behavior/field in this change (dormant seam only).
- [x] 2.6 Add the unmount-cancel effect mirroring `oauth-form.tsx:86-95` (a `useEffect` with a ref-tracked `correlationId` and empty deps): on unmount with a live `correlationId`, call `window.api.sync.authenticateCancel({ correlationId })` (idempotent). Keep the Remove button enabled during pending (design.md D6).

## 3. Visual direction

- [x] 3.1 Apply the `## Visual direction` decisions from `design.md` (Cancel vs Try-Again placement and states, the pending-vs-terminal layout, dead-end copy wording) once the visual-refinement pass has populated them.

## 4. Verification (`verification-before-completion`)

- [x] 4.1 `apps/desktop` renderer test suite green (file-explorer states + the reconnect view), including the new 1.1–1.3 cases.
- [x] 4.2 `scripts/motion-budget.test.ts` green — confirm no `animate-spin` / new motion introduced by the Cancel/Try-Again UI.
- [x] 4.3 `tsc -b` typecheck + lint clean across the touched packages.
- [x] 4.4 Two-stage code review (`requesting-code-review`) between tasks; account-mismatch non-regression explicitly checked.
- [x] 4.5 `openspec validate fix-reconnect-stuck-connecting-button --strict` green.

## 5. Manual smoke (deferred to PENDING_TC)

- [x] 5.1 Running-system smoke: Explore a Google Drive datasource needing reconnect → Reconnect → pick a wrong/non-allowlisted account (Testing-mode `access_denied` dead-end, no callback) → confirm the live **Cancel** recovers immediately to "Try Again" and the copy is the honest dead-end line, never a stuck greyed "Connecting…". Deferred to `PENDING_TC.MD` (requires a real GCP OAuth client + a non-allowlisted Google account; not configurable in this environment). The unit tests 1.1–1.3 cover the state machine in isolation.
