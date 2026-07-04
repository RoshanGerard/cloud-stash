## MODIFIED Requirements

### Requirement: Add-datasource flow uses a provider-agnostic step sequence

The add-datasource dialog SHALL present a two-step flow: step 1 is a provider picker listing every entry in the `providers` registry with its display name and icon; step 2 is a credential form selected by the chosen provider's `credentialsSchema`.

Submission SHALL flow through a single backend surface — the service's `sync:authenticate-{start,complete,cancel}` commands — for every `credentialsSchema` value:

- For `credentialsSchema === "oauth"`, the form SHALL call `window.api.sync.authenticateStart({ providerId, datasourceId? })`. The response carries `{ correlationId, kind: "oauth" }`. The form SHALL render in-dialog status copy conveying that the system browser has opened, subscribe to `auth-*` events scoped to the returned `correlationId` via `window.api.sync.onEvent`, and transition to the dialog-close state when `auth-completed` fires for the matching correlationId. On `auth-cancelled`, `auth-failed`, or `auth-timeout` the form SHALL surface an inline message (`role="status"`, `aria-live="polite"`) and a Retry control that restarts `authenticateStart`. On dialog unmount before terminal state, the form SHALL call `window.api.sync.authenticateCancel({ correlationId })`. The form SHALL NOT call `window.api.datasources.add` or `window.api.datasources.startConsent` for OAuth providers (the latter no longer exists on the surface).
- For non-OAuth schemas (`aws-access-key`, `custom`), the form SHALL call `window.api.sync.authenticateStart({ providerId, datasourceId? })`. The response carries `{ correlationId, kind: "credentials-form", formSchema }`. The form SHALL render fields per the schema, and on user submit call `window.api.sync.authenticateComplete({ correlationId, completion: { kind: "credentials-form", values } })`. On the response's `ok === true` the dialog closes; on `ok === false` an inline error renders. The form SHALL NOT call `window.api.datasources.add`.

When `sync.authenticateStart` resolves with `{ ok: false, error: { tag: "service-config-missing", path, providerId } }`, the form SHALL render an inline message reading "Service configuration missing. Add OAuth credentials to `<path>` (rendered as inline code). See README §Provider OAuth registration." A Retry control SHALL be available — though it will surface the same error until the user fixes the file. The `service-config-missing` tag is NOT a member of `AuthFailedTag`; it surfaces exclusively via the `authenticateStart` response envelope, never via the `auth-failed` event.

Adding a new provider type to the system SHALL require exactly (a) adding a `ProviderDescriptor` entry to the frozen `providers` registry in `packages/ipc-contracts/`, (b) if `credentialsSchema` is a value not already supported, adding one new credential-form component under `features/datasources/credential-forms/`, and (c) for OAuth-class providers, adding the `clientId`/`clientSecret` slot to `services/fs-sync/config.example.json` plus a per-provider OAuth-app-registration section in `README.md`. No changes to the dashboard, card, dialog shell, store, or service handlers SHALL be required.

#### Scenario: Provider picker lists exactly the registered providers

- **WHEN** the add-datasource dialog opens
- **THEN** step 1 renders one selectable option per entry in the `providers` registry — in this change, exactly `google-drive`, `onedrive`, and `amazon-s3` — each with its display name and icon, and no hard-coded provider branches in the dialog component

#### Scenario: Credential step is picked from the descriptor, not the provider id

- **WHEN** the user selects a provider whose `credentialsSchema === "oauth"`
- **THEN** the OAuth credential form component is rendered; swapping the descriptor's `credentialsSchema` to `"aws-access-key"` SHALL cause the access-key form to be rendered instead, without any change to the dialog's code

#### Scenario: OAuth form calls sync.authenticateStart, not datasources.startConsent or datasources.add

- **WHEN** the user clicks "Connect Google Drive" in the OAuth form
- **THEN** the form invokes `window.api.sync.authenticateStart({ providerId: "google-drive" })` exactly once; does NOT invoke `window.api.datasources.startConsent` (which no longer exists on the surface); does NOT invoke `window.api.datasources.add`; displays `role="status"` copy such as "Opening browser — complete authentication and return here"; awaits `auth-*` events scoped to the returned `correlationId`

#### Scenario: OAuth form transitions to done on auth-completed

- **WHEN** an `auth-completed` event arrives via `window.api.sync.onEvent` with a matching `correlationId`
- **THEN** the dialog closes, the dashboard refreshes and renders a new `DatasourceCard` for the newly live datasource (the registry row was added by the desktop event-bridge in response to the paired `credential-persisted` event), and focus returns to the add-datasource trigger in the dashboard toolbar

#### Scenario: OAuth form surfaces cancel, timeout, and failed inline

- **WHEN** an `auth-cancelled`, `auth-timeout`, or `auth-failed` event arrives via `window.api.sync.onEvent` with a matching `correlationId`
- **THEN** the dialog stays open, the inline status region announces the corresponding copy ("Authentication cancelled — you can try again", "Authentication timed out — please try again", or the message from `auth-failed`), and a Retry control is rendered that re-invokes `authenticateStart` with the same `providerId` when activated

#### Scenario: OAuth form surfaces service-config-missing with file path + README pointer

- **WHEN** the renderer calls `window.api.sync.authenticateStart({ providerId: "google-drive" })` and the response is `{ ok: false, error: { tag: "service-config-missing", path: "/home/u/cloudstash/sync_app/config.json", providerId: "google-drive" } }`
- **THEN** the form renders inline copy: "Service configuration missing. Add OAuth credentials to `/home/u/cloudstash/sync_app/config.json` (rendered as inline `<code>`). See README §Provider OAuth registration."; the path string is selectable text; no anchor tag points to the README (sandboxed renderer with no off-domain navigation); a Retry button is present

#### Scenario: Non-OAuth submission flows through sync.authenticateStart + authenticateComplete

- **WHEN** the user submits the S3 access-key form with valid credentials
- **THEN** the form invokes `window.api.sync.authenticateStart({ providerId: "amazon-s3" })` exactly once, receives `{ correlationId, kind: "credentials-form", formSchema }`, then invokes `window.api.sync.authenticateComplete({ correlationId, completion: { kind: "credentials-form", values: { accessKeyId, secretAccessKey, region } } })` exactly once; on `ok: true` the dialog closes; the form does NOT invoke `window.api.datasources.add`

#### Scenario: Successful add (non-OAuth) appends a card to the dashboard

- **WHEN** the credential form submits, `window.api.sync.authenticateComplete(...)` resolves with a `DatasourceSummary`, and the desktop event-bridge has handled the paired `credential-persisted` event by adding the registry row
- **THEN** the dialog closes, the dashboard renders a new `DatasourceCard` for the returned summary in the populated state, and focus returns to the add-datasource trigger in the dashboard toolbar

#### Scenario: Extensibility is enforceable, not just documented

- **WHEN** a hypothetical fourth provider is added to the registry in a test fixture with a new `credentialsSchema`
- **THEN** a Vitest test SHALL render the dialog, select the new provider, and assert that the matching credential form component mounts — failing if the dialog contains provider-id branching

### Requirement: Datasource IPC surface is the single data path

All datasource reads and mutations from the renderer SHALL go through the `window.api.datasources.*` and `window.api.sync.*` surfaces. The renderer SHALL NOT import any provider SDK, any `fs`/`child_process`/`electron`/`drizzle-orm` specifier, or any module under `apps/desktop/src/main/` or `apps/desktop/src/preload/`. The main-process handlers route list/add/remove/action requests through the persistent `DatasourceRegistry`; authenticate requests route through the service via `window.api.sync.authenticate{Start,Complete,Cancel}`. There is no feature-flagged "engine-backed vs fixture" dichotomy — the registry is the single source of truth for datasource membership, and the service is the single source of truth for credentials.

The `window.api.datasources.*` surface SHALL expose: `list()`, `add(req)`, `remove(req)`, `action(req)` (unified pause / resume / sync-now), and `pickFilesToUpload()`. The `startConsent(req)` and `cancelConsent(req)` methods SHALL NOT be present — they have been retired and replaced by the service-mediated `window.api.sync.authenticate{Start,Cancel}` surface. The `upload(req)` method SHALL also be absent (retired earlier — Upload dialog uses `pickFilesToUpload()` + `files.upload`).

The `window.api.sync.*` surface SHALL expose (in addition to the previously specified `enqueueUpload`, `enqueueMirror`, `listJobs`, `getJob`, `cancelJob`, `setRetryPolicy`, `getRetryPolicy`, `getStatus`, `subscribeEvents`, `unsubscribeEvents`, `onEvent`): `authenticateStart(req)`, `authenticateComplete(req)`, `authenticateCancel(req)`. Each call SHALL have a typed request/response pair in `packages/ipc-contracts/src/sync-service-desktop/`.

The engine-bus event types (`DatasourceEvent` / `AnyDatasourceEvent` / `PayloadMap`) and the `datasources:event` channel are removed entirely by this change (see this delta's REMOVED requirements and the `fs-datasource-engine` delta). The renderer no longer observes ANY datasource events through `window.api.datasources` — the consent-* event family was already retired to the sync stream, and the remaining engine-event path is now gone. Authentication lifecycle events flow exclusively on `window.api.sync.onEvent` as `auth-*` events (see the "Renderer subscribes to the sync event stream for authenticate lifecycle" requirement).

#### Scenario: Renderer has no direct SDK import

- **WHEN** `pnpm lint` runs
- **THEN** ESLint reports an error for any file under `apps/desktop/src/renderer/` that imports from `googleapis`, `@microsoft/microsoft-graph-client`, `@aws-sdk/client-s3`, or any other provider SDK package; a dedicated CI grep step SHALL back the ESLint rule

#### Scenario: startConsent and cancelConsent are absent from the surface

- **WHEN** a Vitest test inspects `window.api.datasources` at runtime AND grep-scans the contract, preload, and main-handler trees
- **THEN** `startConsent` and `cancelConsent` are NOT present on `window.api.datasources`; `DatasourcesStartConsentRequest` / `DatasourcesStartConsentResponse` / `DatasourcesCancelConsentRequest` / `DatasourcesCancelConsentResponse` types do NOT exist in `packages/ipc-contracts/src/datasources.ts`; no `ipcMain.handle` under `apps/desktop/src/main/ipc/datasources/` registers a `start-consent` or `cancel-consent` channel; the existing `DATASOURCES_CHANNELS` constant in `packages/ipc-contracts/src/datasources.ts` no longer carries `startConsent` / `cancelConsent` keys

#### Scenario: authenticateStart, authenticateComplete, authenticateCancel are first-class on sync surface

- **WHEN** a type test imports `SyncAuthenticateStartRequest`, `SyncAuthenticateCompleteRequest`, `SyncAuthenticateCancelRequest` from `@cloudstash/ipc-contracts/sync-service-desktop`
- **THEN** all three types are present, the preload exposes the matching methods on `window.api.sync`, the renderer call sites compile under strict mode, and each method has a typed response
