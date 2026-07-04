## Why

The product is being rebranded from **FT5 Cloude Sync** (vendor identity "Forti5") to **CloudStash**. This is change 1 of a 3-change program (rename → restyle → window-chrome). It performs the *identifier, display-string, and runtime-contract-token* rename only — the app behaves and looks identical, just renamed — so the mechanical rename lands cleanly and independently before the monochrome restyle (`restyle-cloudstash-monochrome`) and frameless chrome (`add-frameless-window-chrome`) build on top of it. Doing it now, while the product is still pre-release (v0.0.0), avoids any data-migration burden.

## What Changes

- **Code identifiers**: `@ft5/*` → `@cloudstash/*` (6 workspace packages: desktop, renderer, ipc-contracts, fs-datasource-engine, fs-sync-service, fs-monitor); workspace name `ft5-cloude-sync` → `cloudstash`; `Forti5Logo` symbol/file → `CloudStashLogo` (artwork swap deferred to change 2 — the symbol renames, the SVG stays).
- **ESLint namespace**: custom plugin/rule `ft5/no-raw-error-tag-literal` → `cloudstash/no-raw-error-tag-literal` (plugin key + rule id + every `eslint-disable` pragma, in lockstep).
- **BREAKING** (pre-release, acceptable — no migration): `appId` `tech.forti5.ft5-cloude-sync` → `com.cloudstash.app`; product/app name → `CloudStash`. Adding `productName: "CloudStash"` to `apps/desktop/package.json` moves userData from `%APPDATA%/@ft5/desktop` to `%APPDATA%/CloudStash` — existing dev installs re-onboard from a fresh profile (no data migration by decision).
- **BREAKING** runtime-contract tokens renamed (each a MODIFIED spec delta): localStorage keys `ft5.*` → `cloudstash.*`; `~/Downloads/ft5` → `~/Downloads/CloudStash`; data dir `$HOME/ft5/sync_app` → `$HOME/cloudstash/sync_app`; env `FT5_SYNC_DATA_DIR` → `CLOUDSTASH_SYNC_DATA_DIR` and `FT5_DEV_CREDENTIALS` → `CLOUDSTASH_DEV_CREDENTIALS`; IPC pipe/socket `ft5-sync` → `cloudstash-sync`; desktop DB `ft5.db` → `cloudstash.db`; macOS launchd label `tech.forti5.ft5-sync` → `com.cloudstash.sync`; log prefix `[ft5]` → `[cloudstash]`.
- **Service install-identity** (Windows schtasks `/TN`, Linux systemd unit + XDG `.desktop`): renamed to `cloudstash-sync` / `cloudstash-sync.service` / `cloudstash-sync.desktop` (D1 — confirmed at review). Installer register/unregister scripts change in lockstep and the service is reinstalled.
- **Display strings**: productName, HTML `<title>`, layout description, header wordmark text, footer copyright (`© CloudStash`, retiring Forti5), README, and e2e packaged-path assertions.
- **Method**: applied by a deterministic, ordered, over-match-safe find/replace codemod over `git ls-files` (excluding `openspec/**`, `node_modules`, `.next`, `dist`, `build`, `.worktrees`, `pnpm-lock.yaml`), then a grep-guard asserts zero residual and that brand-neutral tokens (`sync.db`, `sync.sock`, `sync_app`) survive. The guard is the review surface for the bulk sweep. Canonical specs are renamed via the OpenSpec spec deltas below, never by the codemod.

## Capabilities

### New Capabilities
<!-- none — this change introduces no new capabilities -->

### Modified Capabilities
- `app-shell`: clean-install native-module readiness references `@cloudstash/desktop`.
- `datasources-ui`: add-datasource error/inline copy references `$HOME/cloudstash/sync_app/config.json`; IPC surface references `@cloudstash/ipc-contracts/*`.
- `file-explorer`: download toast path `~/Downloads/CloudStash`; downloads/explorer localStorage keys `cloudstash.downloads.*` / `cloudstash.explorer.pageSize`.
- `fs-datasource-engine`: workspace package refs `@cloudstash/ipc-contracts` / `@cloudstash/fs-datasource-engine`; eslint namespace `cloudstash/no-raw-error-tag-literal`.
- `fs-sync-service`: data-dir `$HOME/cloudstash/sync_app`; pipe `cloudstash-sync`; env `CLOUDSTASH_SYNC_DATA_DIR` / `CLOUDSTASH_DEV_CREDENTIALS`; launchd label `com.cloudstash.sync`; install-identity `cloudstash-sync`; `@cloudstash/*` package refs; eslint namespace.
- `fs-sync-supervisor`: connect-or-spawn pipe `cloudstash-sync`; `window.api.sync.*` refs `@cloudstash/ipc-contracts/*`; IPC proxy + `pnpm dev` orchestration refs `@cloudstash/*`.

## Impact

- **Affected code**: all 6 workspace packages (~371 files, ~1046 edits by codemod dry-run), plus manual touches to `apps/desktop/package.json` (add `productName`/rename `name`), `apps/desktop/electron-builder.yml` (productName/appId), `services/fs-sync/installer/**` (D1 install-identity, excluded from the codemod), and a `git mv` of the logo component file.
- **Affected specs**: 6 capabilities, ~38 MODIFIED requirements (no ADDED/REMOVED).
- **Dependencies**: `pnpm install` regenerates `pnpm-lock.yaml` after the scope rename; no new runtime dependency added.
- **Out of scope**: visual/logo/token/theme/font changes (change 2), frameless window chrome (change 3), code-signing/notarization certs (out-of-band ops — a signed CloudStash installer needs certs obtained separately), data migration (none — pre-release), and `openspec/changes/archive/**`.
