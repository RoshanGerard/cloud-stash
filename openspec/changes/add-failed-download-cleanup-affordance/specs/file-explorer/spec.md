## ADDED Requirements

### Requirement: Download failure toast offers a one-click Delete-partial action for kept partials

The download failure toast SHALL render a second action labelled **"Delete partial"** beside the existing "Retry" action when, and only when, the `download-failed` event carries `partialKept === true`. This toast is emitted from the single source of failure-toast UX — the `download-job-toast.ts` toaster's `download-failed` event handler (per "Download failure toast is event-driven, single-sourced"). When `partialKept` is absent or `false` (a delete-disposition failure, a pre-write failure, or an event from a service that predates this field), the toast SHALL render only the existing "Retry" action and no Delete-partial affordance.

The Delete-partial action SHALL be one-click — no size-threshold or
secondary confirmation — because deleting a kept partial is non-destructive
of the source (the file remains on the provider and a Retry re-downloads it
in full). Activating it SHALL invoke the preload-exposed delete-partial
binding on `window.api` with the failed download's `downloadJobId` (the same
id the toaster correlates with this toast slot; for hydrated toasts, the
`downloadJobId` carried on the hydration record). On a successful response
(`{ deleted: <boolean> }`) the toast SHALL be dismissed. On an error
response the toast SHALL remain and surface the failure reason inline
(e.g. "Couldn't delete: <reason>").

Adding the Delete-partial action SHALL NOT add a Cancel action to the
terminal failure toast — the invariant that terminal toasts carry no Cancel
action (per "Active download toast renders a Cancel action button") is
preserved.

The command SHALL be wired across all four layers: a typed request/response
pair in `packages/ipc-contracts`, an `ipcMain.handle` bridge under
`apps/desktop/src/main/`, a preload binding via `contextBridge`, and the
renderer call site in `download-job-toast.ts`.

#### Scenario: Kept-partial failure toast shows Delete partial beside Retry

- **WHEN** the toaster receives `download-failed { downloadJobId: "job-A", tag: "exhausted-retries", message: "…", partialKept: true }`
- **THEN** the failure toast renders both a "Retry" action and a "Delete partial" action; no Cancel action is present

#### Scenario: Deleted-partial failure toast shows only Retry

- **WHEN** the toaster receives `download-failed { downloadJobId: "job-B", tag: "other", message: "integrity check failed", partialKept: false }` (or with `partialKept` omitted entirely)
- **THEN** the failure toast renders only the "Retry" action; no Delete-partial action appears

#### Scenario: Clicking Delete partial dispatches the command and dismisses on success

- **WHEN** the user clicks "Delete partial" on a failure toast for `downloadJobId: "job-A"` and the delete-partial binding resolves `{ deleted: true }`
- **THEN** the renderer invokes the delete-partial binding exactly once with `{ downloadJobId: "job-A" }`; on the successful response the toast is dismissed

#### Scenario: Permission failure keeps the toast and surfaces the reason inline

- **WHEN** the user clicks "Delete partial" and the delete-partial binding resolves an error envelope (e.g. an `EACCES` permission failure)
- **THEN** the toast is NOT dismissed; it surfaces the failure reason inline; the "Retry" action remains available

#### Scenario: Delete-partial command is wired across all four layers

- **WHEN** the four-layer wiring for the delete-partial command is enumerated
- **THEN** it has a typed request/response pair in `packages/ipc-contracts`, an `ipcMain.handle` bridge under `apps/desktop/src/main/`, a preload binding on `window.api`, and a renderer call site in `download-job-toast.ts`; missing any layer SHALL cause the wiring test to fail
