## ADDED Requirements

### Requirement: Google Drive exports Docs Editors files via `files.export`

The Google Drive strategy's `downloadFile` SHALL detect Google Workspace native files (mime `application/vnd.google-apps.<subtype>`, excluding the folder mime) during its metadata pre-fetch and route the **exportable** subtypes through `drive().files.export({ fileId, mimeType: <exportMime> }, { responseType: "stream" })` instead of `files.get?alt=media`. The exportable subtypes and their default export formats are the five entries in `GOOGLE_APPS_EXPORT_FORMATS`:

| Source mime | Export mime | Saved extension |
|---|---|---|
| `application/vnd.google-apps.document` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `.docx` |
| `application/vnd.google-apps.spreadsheet` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `.xlsx` |
| `application/vnd.google-apps.presentation` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `.pptx` |
| `application/vnd.google-apps.drawing` | `image/png` | `.png` |
| `application/vnd.google-apps.script` | `application/vnd.google-apps.script+json` | `.json` |

The export response stream SHALL be wrapped in the same byte-counting `Transform` the alt=media path uses, so `options.onProgress` fires as bytes flow and AbortSignal-driven cancellation is honored. A Google Apps mime that is NOT an exportable subtype (Forms, Jamboard, Sites, Shortcuts, and any unknown future `application/vnd.google-apps.<subtype>`) SHALL keep rejecting with `DatasourceError { tag: "unsupported", retryable: false }`. The strategy MUST NOT issue an `alt=media` call for any Google Apps native file.

#### Scenario: exportable Google Doc routes through files.export

- **WHEN** the consumer invokes `downloadFile` for a file whose pre-fetched mime is `application/vnd.google-apps.document`
- **THEN** the strategy issues `files.export({ fileId, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, { responseType: "stream" })`, issues NO `files.get?alt=media` call, and resolves with `{ stream, contentLength }` where the stream is the byte-counting `Transform` wrapper

#### Scenario: each exportable subtype uses its default export mime

- **WHEN** the consumer invokes `downloadFile` for a `spreadsheet`, `presentation`, `drawing`, or `script` Google Apps file
- **THEN** the strategy calls `files.export` with the export mime from `GOOGLE_APPS_EXPORT_FORMATS` for that subtype (`…spreadsheetml.sheet`, `…presentationml.presentation`, `image/png`, `application/vnd.google-apps.script+json` respectively) and resolves with a streamed result

#### Scenario: export ignores rangeStart and returns no contentRange

- **WHEN** the consumer invokes `downloadFile` with `{ rangeStart: <N> }` (N > 0) for an exportable Google Apps file
- **THEN** the strategy issues `files.export` WITHOUT a `Range` header (export cannot serve a byte range), streams the full body from byte 0, and the resolved `DownloadResult` carries NO `contentRange` field — so the consumer's range-not-honored recovery (rewrite-from-0) applies

#### Scenario: non-exportable Google Apps mime keeps the unsupported refusal

- **WHEN** the consumer invokes `downloadFile` for a Google Form (`application/vnd.google-apps.form`) or any other non-exportable Google Apps mime
- **THEN** the strategy rejects with `DatasourceError { tag: "unsupported", retryable: false }` and message "Google Drive documents download not supported"; no `files.export` and no `alt=media` call is issued

#### Scenario: unknown future Google Apps subtype keeps the refusal

- **WHEN** the consumer invokes `downloadFile` for a mime `application/vnd.google-apps.somethingnew` that is absent from `GOOGLE_APPS_EXPORT_FORMATS`
- **THEN** the strategy rejects with `DatasourceError { tag: "unsupported", retryable: false }` (defence-in-depth — unknown subtypes are never exported by default)

#### Scenario: binary Drive file download is unchanged

- **WHEN** the consumer invokes `downloadFile` for a binary file (e.g. mime `text/plain` or `application/pdf`)
- **THEN** the strategy flows through `files.get?alt=media` exactly as before — no `files.export` call — and resolves with the streamed result and `contentLength` from the response headers

#### Scenario: export quota-exceeded surfaces the friendly provider error

- **WHEN** `files.export` rejects because the document exceeds Drive's export size cap
- **THEN** the strategy surfaces the error through `normalizeErrorImpl` (the existing files-error-mapping path), not as raw provider JSON

#### Scenario: AbortSignal-driven cancel is honored on the export path

- **WHEN** the consumer invokes `downloadFile({ signal })` for an exportable Google Apps file and aborts the signal mid-stream
- **THEN** the `signal` is forwarded into the `files.export` call, the underlying request is aborted, the returned stream errors (AbortError or normalized `tag: "cancelled"`), and no further bytes flow

#### Scenario: mid-export stream error reaches the consumer

- **WHEN** the `files.export` response stream errors mid-flight (e.g. a transient network drop)
- **THEN** the error is forwarded through the byte-counting `Transform` (via the source stream's `error` listener) and surfaces normalized to the consumer's pipe — so fs-sync's environmental-retry path can classify it

### Requirement: Google Apps export formats are a single shared source of truth

The mapping from a Google Apps source mime to its `{ exportMime, extension }` SHALL be defined exactly once, as the `GOOGLE_APPS_EXPORT_FORMATS` constant in `packages/ipc-contracts`. The engine consumes `exportMime`; the renderer consumes `extension`. The constant is plain data (no request/response field), so it introduces no IPC wire change. A drift-guard test SHALL enforce that the engine's set of exportable subtypes and the renderer's extension lookup are derived from this single constant, so the two consumers cannot disagree on which subtypes are exportable or which extension a subtype maps to.

#### Scenario: engine and renderer derive from the same constant

- **WHEN** the drift-guard test enumerates every entry in `GOOGLE_APPS_EXPORT_FORMATS`
- **THEN** for each entry the engine treats the source mime as exportable (routes it through `files.export` with the entry's `exportMime`) AND the renderer produces the entry's `extension` for the saved filename — and a source mime absent from the constant is exportable by neither

#### Scenario: constant introduces no wire field

- **WHEN** the IPC contract for `files:download` is inspected
- **THEN** no new request or response field is added for export-format selection (v1 uses the silent per-subtype default; the engine reads the constant internally)
