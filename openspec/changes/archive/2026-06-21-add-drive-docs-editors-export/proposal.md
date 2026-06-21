# Proposal: Add Google Drive Docs Editors export support

**Status**: Proposed. Spawned during `add-engine-rename-download` post-archive smoke on 2026-04-28 — surfaced when the user attempted to download a Google Doc and the strategy correctly refused (per binary-only contract) but the underlying Export API IS available and would close the gap. Open questions resolved via brainstorming on 2026-06-21 (decisions in `design.md`).

## Why

Drive's `files.get?alt=media` only works for files with binary content. Google Docs / Sheets / Slides / Drawings / Apps Script files have no binary content; attempting to download them returns a 403 with reason `fileNotDownloadable` and the prose `"Use Export with Docs Editors files"`. `add-engine-rename-download` shipped binary-only download per its original scope, so the user-visible result was a raw provider-error toast.

The post-archive fix on `add-engine-rename-download` made the failure user-friendly: the Drive strategy pre-fetches metadata, detects `application/vnd.google-apps.*` mimes, and refuses with a clean `tag: "unsupported"` message ("Google Drive documents download not supported"). That closes the immediate UX gap but leaves a real capability hole — Drive **does** support exporting these files via `files.export({ fileId, mimeType: <export-mime> })` with a `responseType: "stream"` override that mirrors the alt=media path. Users can already export from Drive's web UI ("File → Download → choose format"); the desktop app should match.

This change promotes the existing refusal branch from "refuse ALL Google Apps files" to "export the **exportable** subtypes via `files.export`; refuse only the non-exportable ones" so a single click from the file explorer downloads the document in the format users expect (Word for Docs, Excel for Sheets, etc.).

## What this change does

- **Engine.** In the Drive strategy's `doDownloadFileImpl`, the existing Google Apps detection branch (already in place from the post-archive fix) routes **exportable** mimes through `drive().files.export({ fileId, mimeType: <export-mime> }, { responseType: "stream", signal })` instead of refusing. The byte-counting `Transform` wrapper from the alt=media path is reused unchanged. Non-exportable Google Apps mimes (Forms, Jamboard, Sites, Shortcuts, unknown future subtypes) keep throwing the friendly `tag: "unsupported"` refusal.
- **Shared format table.** A single source of truth `GOOGLE_APPS_EXPORT_FORMATS` (`mimeType → { exportMime, extension }`) lives in `packages/ipc-contracts`. The engine reads `exportMime`; the renderer reads `extension`. It is a plain constant, **not** a request/response field — there is no wire-protocol change.
- **Default export formats per Apps subtype** (silent default, no picker in v1):
  - `document` → `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`)
  - `spreadsheet` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`)
  - `presentation` → `application/vnd.openxmlformats-officedocument.presentationml.presentation` (`.pptx`)
  - `drawing` → `image/png` (`.png`)
  - `script` → `application/vnd.google-apps.script+json` (`.json`)
- **Filename.** The renderer download orchestrator appends the matching extension to the saved file's basename (`<title>.docx`, etc.) because Google Apps titles carry no extension. Policy is **append-always** (a Doc titled `Notes.txt` saves as `Notes.txt.docx`); the orchestrator never parses or strips the existing title (respects the renderer `scripts/no-extension-parsing.test.ts` guardrail forbidding `lastIndexOf(".")`).
- **Resilience.** The export branch ignores `rangeStart` and returns no `contentRange` (export cannot honor `Range:`). fs-sync's **existing** rewrite-from-0 recovery handles a mid-export network blip with zero fs-sync changes; `contentLength: null` is already tolerated and the integrity check is auto-skipped (Google Apps files carry no `md5Checksum`).
- **Tests.** One happy-path export test per exportable subtype (five total), a binary-regression test (a `.txt` file still flows through alt=media unchanged), a kept-refusal test for Forms + unknown future subtypes, a quota-exceeded test surfacing the friendly provider-error pattern, renderer extension-append tests (per subtype + the `Notes.txt` append-always edge + no-append for binary), and a drift-guard asserting the engine and renderer agree on the shared table.

## Capabilities

- `fs-datasource-engine` — the Drive strategy's export branch + the shared format table it reads.
- `file-explorer` — the renderer download orchestrator appends the export extension to the saved filename.

## Out of scope

- **"Download as…" picker.** v1 uses the silent per-subtype default. A user-facing format chooser (and the request-field plumbing it would need) is deferred to a follow-up.
- **Microsoft 365 files** (Word / Excel / PowerPoint hosted on OneDrive). These already have binary content downloadable via OneDrive's standard download endpoint; no export equivalent is needed.
- **Google Forms / Jamboard / Sites / Shortcuts export.** The Drive API's `files.export` does **not** support these source types (they are absent from the Drive export-formats reference). They stay on the friendly `tag: "unsupported"` refusal path.
- **User-customisable default format per Apps subtype** (e.g. "always export Sheets as CSV instead of XLSX"). Defaults are wired in code; per-user overrides are deferred to the settings store.
- **Mid-export resume.** `files.export` doesn't support `Range:` the way `files.get?alt=media` does; resume on partial export is a separate problem and is out of scope. Exports recover by full restart (resilient-by-restart, bounded by the existing retry budget).
- **Drive export quotas.** Drive imposes a maximum file size for exports (currently ~10 MB for documents). v1 surfaces the provider's quota-exceeded error verbatim; a follow-up may add a quota-aware pre-check.

## Resolved questions (brainstorming 2026-06-21 — see `design.md` Decisions)

1. **Export scope** → All five exportable subtypes (`document`, `spreadsheet`, `presentation`, `drawing`, `script`). Forms/Jamboard/Sites stay refused (Drive API can't export them).
2. **Format choice UX** → Silent per-subtype default. No picker in v1.
3. **Resilience contract** → Resilient-by-restart, reusing fs-sync's existing rewrite-from-0 path. No resume.
4. **Filename extension policy** → Append-always (`<title>.<ext>`); never strip.

## Acceptance criteria

- Clicking Download on a Google Doc fetches via `files.export({ fileId, mimeType: <DOCX> })`, saves the file as `<title>.docx`, emits the standard `downloading` / `file-downloaded` event sequence, and the success toast shows.
- Clicking Download on each of the other four exportable Apps subtypes (Sheet / Slide / Drawing / Script) succeeds with the matching default format + extension.
- Downloading a Google **Form** (or any non-exportable Google Apps mime, including unknown future `application/vnd.google-apps.<future>` subtypes) continues to surface the friendly `tag: "unsupported"` refusal — verified by a kept-refusal test.
- Binary Drive files (`text/plain`, `application/pdf`, etc.) continue to flow through `files.get?alt=media` with no behaviour change — verified by a regression test that downloads a `.txt` file end-to-end.
- A mid-export transient failure recovers via fs-sync's existing rewrite-from-0 path with no fs-sync code change; the completed export's local size matches the bytes delivered (no false byte-count-mismatch deletion).
- Test coverage: one happy-path export test per exportable subtype (five total), the binary-regression test, the kept-refusal test (Form + unknown subtype), a quota-exceeded test, renderer extension-append tests, and the engine↔renderer shared-table drift-guard.

## Provenance

- Spawned during `add-engine-rename-download` post-archive manual smoke on 2026-04-28 by user dev2@forti5.tech. The strategy correctly threw `tag: "unsupported"` per the binary-only spec, but the user noted the export endpoint exists and the limitation is artificial.
- The post-archive fix landed clean refusal copy + a parked-stub pointer (this proposal). The actual capability work happens here.
- Brainstorming on 2026-06-21 resolved the four open questions and corrected the original `form → zip` mapping (the Drive API does not export Forms). The original acceptance criterion to capture the refusal as a `## REMOVED Requirements` block is **moot**: the post-archive refusal was a code-level guardrail that was never written into a canonical spec requirement, so there is nothing to remove — the spec delta is purely `## ADDED`.
