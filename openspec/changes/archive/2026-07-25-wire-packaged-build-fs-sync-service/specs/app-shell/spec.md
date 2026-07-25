## ADDED Requirements

### Requirement: Packaged application contains a runnable sync-service bundle

The packaged application SHALL contain the fs-sync service as a runnable module at a path the desktop main process can resolve from `app.getAppPath()`, and that module SHALL be able to load every runtime dependency it requires without any additional resolution configuration at spawn time.

The service module SHALL be emitted by the desktop application build as an additional entry point alongside the main-process bundle, so it is packaged inside the application archive rather than as loose files beside it. Workspace packages it depends on SHALL be bundled into that entry point; third-party runtime dependencies SHALL resolve through ordinary Node resolution from within the archive, and native dependencies through the packager's automatic unpacked-module redirect.

Non-code runtime assets the service reads from disk — including its SQL migrations — SHALL be packaged at the location the service resolves them from, since bundling the service's JavaScript does not carry them. A service whose assets are absent fails during startup and never begins listening.

The desktop application build SHALL depend on the service's own compiled output rather than compiling the service's TypeScript sources itself, so the service continues to be built under its own configuration and remains free of any dependency on the desktop application.

A packaging configuration that omits the service, omits its runtime assets, or places either where they cannot be resolved, SHALL be treated as a build defect: the packaged application would start, present its full interface, and then reject every sync operation for the lifetime of the process.

#### Scenario: The service module is present in a packaged build

- **WHEN** the application is packaged for any supported target
- **THEN** the service entry point exists at the path the main process resolves for spawning, and it is packaged inside the application archive rather than as loose files alongside it

#### Scenario: The bundled service resolves its dependencies

- **WHEN** the packaged service module is executed by the application's own bundled Node runtime
- **THEN** it loads its third-party runtime dependencies and its native dependencies successfully, without a `NODE_PATH` override, a per-spawn resolution shim, or a second copy of any native module

#### Scenario: The bundled service finds its runtime assets

- **WHEN** the packaged service starts and applies its database migrations
- **THEN** it locates the migration files inside the packaged application and completes startup, rather than failing because bundling carried only its JavaScript

#### Scenario: Packaging a stale service is prevented

- **WHEN** the desktop application is packaged
- **THEN** the service's compiled output is rebuilt as part of the packaging path, so the bundled service cannot lag the service sources

#### Scenario: A packaged build is exercised end to end before release

- **WHEN** the packaged artifact is verified
- **THEN** an automated check launches the real packaged application, lets it start its own service, and asserts that a feature requiring service data renders — proving the supervisor, the bundled service, its dependency resolution, and the IPC path all work together
