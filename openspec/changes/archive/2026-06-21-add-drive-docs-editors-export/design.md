## Context

`add-engine-rename-download` shipped a binary-only `downloadFile` primitive. Its post-archive smoke (2026-04-28) surfaced that Google Workspace native files (Docs / Sheets / Slides / Drawings / Apps Script) have no binary content and cannot flow through Drive's `files.get?alt=media` endpoint — the provider returns `403 fileNotDownloadable`. The post-archive fix added a metadata pre-fetch + a friendly `tag: "unsupported"` refusal so the user sees a clean message instead of raw provider JSON. That fix is a code-level guardrail; it was **not** written into any canonical spec requirement (the only `google-apps` mention in `openspec/specs/` is the unrelated folder-rename context).

Drive does support exporting these files via `files.export({ fileId, mimeType }, { responseType: "stream" })`. This change promotes the refusal branch to route exportable subtypes through `files.export` while keeping the refusal for subtypes the Drive API genuinely cannot export.

**Current-state anchors (verified against the codebase 2026-06-21):**

- `packages/fs-datasource-engine/src/strategies/googledrive-client.ts` `doDownloadFileImpl` (~line 1836): metadata pre-fetch (`files.get({ fileId, fields: "mimeType" })`) → Google Apps detection branch (~line 1867) → currently throws `DatasourceError { tag: "unsupported" }`. The alt=media path below wraps the source stream in a `Transform` byte-counter (~line 1928).
- `DriveFilesLike` interface (~line 131) declares `list / get / create / update / delete` — **no `export`** yet.
- `createDefaultDriveFactory` (~line 467) returns the real `google.drive({ version: "v3" })` client whose `files` surface already includes `export`; the duck-type interface must add it.
- `FileEntry` (`packages/ipc-contracts/src/files.ts:118`) declares `mimeType: string | null`, **but the fs-sync entry mapper hardcodes it to `null`** (`services/fs-sync/src/commands/files-entry-mapping.ts:85` — the engine's `DatasourceFileEntry` has no top-level mime). The raw Drive mime instead travels in `providerMetadata`: the engine stores it at `googledrive-client.ts:874` (`...(file.mimeType ? { mimeType: file.mimeType } : {})`) and `flattenProviderMetadata` preserves the string through to the renderer (`files-entry-mapping.ts:88`). So the renderer must key on `entry.providerMetadata.mimeType` (string-guarded), NOT the always-null `entry.mimeType`.
- The renderer download orchestrator (`apps/desktop/src/renderer/src/features/file-explorer/use-download-orchestrator.ts`) builds `toPath` via `joinFolderAndName(folder, entry.name)` → `sanitizeFilenameForOS`. `entry.name` for a Google Apps file has no extension.
- fs-sync's download handler (`services/fs-sync/src/commands/files-download.ts`) tolerates `contentLength: null` (line ~1387: `if (finalContentLength === null || bytesWritten === finalContentLength) break;`), skips the integrity check when the provider advertises no hash (~line 1416–1421), and recovers a Range-not-honored response by dropping the partial and restarting from byte 0 with a sticky `rangeUnsupported` flag (~lines 1199–1241).
- The engine package depends on `@ft5/ipc-contracts` (`workspace:*`); the renderer imports from it too — so it is the correct shared home for the format table.

## Goals / Non-Goals

**Goals:**

- One-click download of the five exportable Google Apps subtypes in their default Office/PNG/JSON format, saved with the correct extension.
- Keep binary Drive downloads byte-for-byte unchanged.
- Keep a friendly refusal for the Apps subtypes the Drive API cannot export (Forms, Jamboard, Sites, Shortcuts, unknown future subtypes).
- Achieve the above with **zero wire-protocol change** and **zero fs-sync change** — the surface is the engine strategy + a shared constant + the renderer's filename construction.
- Engine and renderer share one source of truth for `mime → { exportMime, extension }` so they cannot drift.

**Non-Goals:**

- A "Download as…" format picker (and the request-field plumbing it would require). Silent per-subtype default only.
- Mid-export resume. Export cannot honor `Range:`; recovery is full restart.
- Google Forms / Jamboard / Sites / Shortcuts export (Drive API does not support it).
- Per-user default-format overrides in settings.
- A quota-aware pre-check for Drive's export size cap.
- OneDrive / S3 changes — this is Drive-strategy-local.

## Decisions

### D1 — Promote the existing refusal branch to route exportable mimes through `files.export`

In `doDownloadFileImpl`, the Google Apps detection branch looks the pre-fetched `metaMimeType` up in `GOOGLE_APPS_EXPORT_FORMATS`:

- **Hit** (exportable subtype) → call `drive().files.export({ fileId, mimeType: entry.exportMime }, { responseType: "stream", ...(signal ? { signal } : {}) })`, wrap the response stream in the **same** `Transform` byte-counter the alt=media path uses, and return `{ stream, contentLength: <header or null> }`.
- **Miss** (non-exportable Google Apps mime — Forms, Jamboard, Sites, Shortcuts, unknown `application/vnd.google-apps.<future>`) → keep throwing `DatasourceError { tag: "unsupported", retryable: false, message: "Google Drive documents download not supported" }`.

The folder mime (`application/vnd.google-apps.folder`) remains excluded from the branch entirely (folders have their own upstream `kind: "folder"` path — unchanged).

The `DriveFilesLike` duck-type interface gains an `export(params, options?)` method mirroring the `get` overload shape (`{ data: unknown; headers?: Record<string, string> }`); the real SDK client already provides it.

**Why over alternatives:**
- *Return a `suggestedExtension`/`exportedMime` on `DownloadResult` and let fs-sync rename post-pipe* — rejected: it adds a wire field, fights fs-sync's "renderer picks `toPath`, fs-sync asserts size against it" model, and breaks the conflict-dialog flow that keys on `toPath`. The renderer already has `entry.mimeType`, so it can compute the extension up front with no new field.
- *A separate `exportFile` engine method* — rejected: export IS a download (stream + bytes-to-disk). A parallel method would duplicate the byte-counter, the cancel wiring, and the consumer contract. Routing inside `doDownloadFileImpl` reuses all of it.

### D2 — Resilient-by-restart: export ignores `rangeStart`, returns no `contentRange`

`files.export` cannot serve a byte range. The export branch **ignores `options.rangeStart`** and always streams the full body, returning `{ stream, contentLength }` with **no `contentRange`**.

This composes with fs-sync's existing recovery with **zero fs-sync changes**:
- First attempt: `rangeStart = 0`, export streams full body, fs-sync pipes from byte 0. Happy path.
- A mid-export transient failure → fs-sync's environmental retry re-issues `downloadFile` with `rangeStart > 0` (computed from bytes-on-disk) → the export branch returns no `contentRange` → fs-sync's rewrite-from-0 path (files-download.ts ~1199–1241) drops the partial, sets `rangeUnsupported` sticky, and restarts from byte 0. Subsequent retries are forced to `rangeStart = 0`.
- `contentLength: null` (export responses are server-generated, often chunked, may omit `Content-Length`) → fs-sync's size assertion is null-guarded (line ~1387) and trusts stream-end. Integrity is auto-skipped (Google Apps files carry no `md5Checksum`).

**Why over fail-fast:** a *fail-fast* contract (export throws non-retryable when `rangeStart > 0`) would turn a single transient blip mid-export into an immediate terminal failure requiring a manual Retry click — worse UX. Resilient-by-restart reuses tested machinery; the only cost is re-downloading from byte 0 on each retry, which is cheap because exports are bounded by Drive's ~10 MB cap.

### D3 — Single source of truth: `GOOGLE_APPS_EXPORT_FORMATS` in `packages/ipc-contracts`

```ts
// packages/ipc-contracts/src/files.ts (or a sibling module re-exported from index)
export const GOOGLE_APPS_EXPORT_FORMATS = {
  "application/vnd.google-apps.document":     { exportMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" },
  "application/vnd.google-apps.spreadsheet":  { exportMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",      extension: ".xlsx" },
  "application/vnd.google-apps.presentation": { exportMime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" },
  "application/vnd.google-apps.drawing":      { exportMime: "image/png",                                  extension: ".png"  },
  "application/vnd.google-apps.script":       { exportMime: "application/vnd.google-apps.script+json",    extension: ".json" },
} as const;
```

It is a **plain constant**, not a request/response field — no IPC/preload change, so the project's four-piece-coordination rule for renderer-callable operations does not apply. The engine reads `.exportMime` (keyed by the mime from its own metadata pre-fetch); the renderer reads `.extension` (keyed by `entry.providerMetadata.mimeType`, string-guarded — see D5). A drift-guard test (run on both the engine and the renderer side, or a shared test importing the const) asserts the two consumers agree — i.e. for every exportable mime the engine treats as exportable, the renderer produces the matching extension, and vice versa.

**Why ipc-contracts over the engine package:** the renderer must not pull the engine package (it transitively imports `googleapis`, `@aws-sdk`, Node streams) into its sandboxed bundle. ipc-contracts is the existing pure-types/consts package already shared by main and renderer.

### D4 — Silent per-subtype default; no picker

The renderer downloads in the default format for the subtype with no prompt — matching Drive's web "Download" default. This is what eliminates the wire change (no format param to thread). A "Download as…" picker is deferred to a follow-up stub.

### D5 — Append-always filename policy

For a Google Apps `FileEntry`, the renderer orchestrator reads the provider mime from `entry.providerMetadata.mimeType` (guarded: `typeof … === "string"`, else treat as absent — `entry.mimeType` is always `null`, see Context). When that mime is a key in `GOOGLE_APPS_EXPORT_FORMATS`, it derives the saved basename as `entry.name + GOOGLE_APPS_EXPORT_FORMATS[mime].extension` **before** `joinFolderAndName` / `sanitizeFilenameForOS`. It does not parse, split, or strip the existing title.

- A Doc titled `Quarterly Report` → `Quarterly Report.docx`.
- A Doc literally titled `Notes.txt` → `Notes.txt.docx` (honest about the real format; never strips a segment of the user's title).

**Why append-always over strip-and-replace:** strip-and-replace would need to find the "existing extension," which means extension parsing — forbidden on the renderer side by `scripts/no-extension-parsing.test.ts` (the `lastIndexOf(".")` guardrail). Append-always needs no parsing, is unambiguous, and can never destroy a meaningful part of a title that merely looks extension-shaped. The path still flows through `sanitizeFilenameForOS` for OS-invalid characters.

### D6 — Spec delta is purely `## ADDED`

The original stub's acceptance criterion to capture the refusal as a `## REMOVED Requirements` block is moot: the post-archive refusal was never a canonical spec requirement (verified — no such requirement exists in `openspec/specs/`). There is nothing to remove. The delta:
- `specs/fs-datasource-engine/spec.md` `## ADDED` — the Drive strategy exports exportable Google Apps mimes via `files.export` and keeps refusing the rest; the shared table is the single source of truth.
- `specs/file-explorer/spec.md` `## ADDED` — the download orchestrator appends the export extension (append-always) to the saved filename for Google Apps entries.

The existing `downloadFile` primitive requirements (`is a stateless one-shot HTTP primitive`, the rangeStart/206/contentRange scenarios) are **unchanged** — the export branch's "no `contentRange`, full body" behavior already matches the documented "provider returns 200 OK" scenario, so no `## MODIFIED` is needed.

## Risks / Trade-offs

- **Flaky network wastes the retry budget on full restarts** → each environmental retry re-downloads the export from byte 0 (no resume). Bounded by Drive's ~10 MB export cap and the existing 5-attempt budget, so the worst case is ~50 MB of wasted transfer before terminal `exhausted-retries` (partial kept, but a partial export is not resumable). Acceptable for v1; a quota/size-aware path is a follow-up.
- **`contentLength: null` on export responses** → no size assertion to catch a truncated export. Mitigation: relies on stream-end + the provider closing the stream cleanly; a truncated transfer surfaces as a stream error (environmental → retry) rather than a silent short file. The integrity check can't run (no hash) — same as today's binary path when a provider omits the hash.
- **Drive export size cap (~10 MB for Docs)** → a large Doc export fails with the provider quota error. v1 surfaces it verbatim via the existing files-error-mapping helper (`tag: "other"` / provider message). Documented Non-Goal; quota pre-check deferred.
- **Engine↔renderer table drift** → if a future edit adds a subtype to the engine's view but not the renderer's (or changes an extension), saved files could mismatch the exported bytes. Mitigation: the drift-guard test (D3) fails the build on disagreement.
- **Unknown future `application/vnd.google-apps.<new>` subtype** → not in the table → falls through to the kept refusal (no crash, friendly message). Defence-in-depth preserved by the existing unknown-subtype test.
- **`FileEntry.mimeType` is a latent footgun** → the interface advertises `string | null` but `mapEngineEntryToFileEntry` hardcodes `null` for every provider, so a future dev keying on `entry.mimeType` (as the first draft of this design mistakenly did) gets silent no-ops. Mitigation: this change reads `entry.providerMetadata.mimeType` and the renderer extension-append tests assert the saved basename end-to-end from a representative Google Apps `FileEntry` (so the drift-guard's table-self-consistency is backed by a path-exercising test). Properly populating `FileEntry.mimeType` from `providerMetadata` for all providers is the cleaner long-term fix but is deliberately out of scope here — it would change observable response behavior across every provider/entry (an Outcome-3 contract change warranting its own change), and `providerMetadata.mimeType` is only reliably present for Drive today.
- **`.json` Apps Script export is niche** → a raw Apps Script JSON is only useful for re-import. Included because it is the sole export format the Drive API offers for scripts and costs one table row; surfaced silently like the others. If it proves confusing in smoke, hiding Apps Script files from the explorer is a separate UI decision.

## Migration Plan

No data migration. Deploy is a code change behind no flag:
1. Add `GOOGLE_APPS_EXPORT_FORMATS` to ipc-contracts; rebuild the package so the const resolves for both consumers.
2. Engine: add `export` to `DriveFilesLike`, route the branch, update the existing refusal tests (Doc/Sheet/Slide/Drawing/Script arms flip to export happy-paths; Form + unknown-subtype + folder arms stay).
3. Renderer: append the extension in the orchestrator; add the extension-append tests.

Rollback is a straight revert — the refusal branch returns and Google Apps downloads go back to the friendly `unsupported` message. No persisted state depends on this change.

## Open Questions

None outstanding — the four brainstorming questions are resolved (proposal "Resolved questions"). One deferred product decision (whether to hide Apps Script files from the explorer entirely) is noted as a Risk, not a blocker.
