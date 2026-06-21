## 1. Shared format table (ipc-contracts)

- [ ] 1.1 Write a failing test asserting `GOOGLE_APPS_EXPORT_FORMATS` exists in `@ft5/ipc-contracts` with exactly the five entries (document→docx, spreadsheet→xlsx, presentation→pptx, drawing→png, script→json), each `{ exportMime, extension }`, and that it is `as const`.
- [ ] 1.2 Add `GOOGLE_APPS_EXPORT_FORMATS` to `packages/ipc-contracts/src/files.ts` (or a sibling module) and re-export it from the package index. Add a typed helper type for an exportable mime key. Make 1.1 pass.
- [ ] 1.3 Build the ipc-contracts package (`pnpm --filter @ft5/ipc-contracts build`) so the const resolves for engine + renderer consumers.

## 2. Engine — Drive strategy export branch

- [x] 2.1 Extend the `DriveFilesLike` duck-type interface in `packages/fs-datasource-engine/src/strategies/googledrive-client.ts` with `export(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ data: unknown; headers?: Record<string, string> }>` (mirrors the `get` overload). Update the fake-drive test harness in `googledrive-client.test.ts` to support an `exports`/`exportStreams` responder analogous to `gets`/`getStreams`.
- [x] 2.2 Write failing engine tests: one happy-path export per exportable subtype (document/spreadsheet/presentation/drawing/script) asserting (a) `files.export` is called with the mapped `exportMime`, (b) NO `alt=media` call is issued, (c) the resolved stream byte-counts via `onProgress`, (d) the result carries no `contentRange`.
- [x] 2.3 Write failing engine test: `downloadFile({ rangeStart: N>0 })` for an exportable subtype issues `files.export` with NO `Range` header and resolves with no `contentRange` (resilient-by-restart contract, D2).
- [x] 2.4 Promote the Google Apps detection branch in `doDownloadFileImpl`: look `metaMimeType` up in `GOOGLE_APPS_EXPORT_FORMATS`; on hit, call `files.export({ fileId, mimeType: exportMime }, { responseType: "stream", ...(signal?{signal}:{}) })`, wrap in the existing `Transform` byte-counter, return `{ stream, contentLength }` (no `contentRange`); on miss, keep throwing the `tag:"unsupported"` refusal. Make 2.2 + 2.3 pass.
- [x] 2.5 Update the existing refusal tests (`googledrive-client.test.ts` "doDownloadFileImpl Google Apps native refusal" describe block ~line 3591): the Doc arm + the spreadsheet/presentation/drawing/script arms become export happy-paths; keep the **Form** arm, the **unknown-future-subtype** arm, and the **folder-not-caught** arm as refusal/uncaught (split the parameterized subtypes test so only `form` remains in the refusal loop).
- [x] 2.6 Write + pass a binary-regression test: a `text/plain` file still flows through `files.get?alt=media` with no `files.export` call and unchanged `contentLength`.
- [x] 2.7 Write + pass a quota-exceeded test: `files.export` rejecting (export size cap) surfaces through `normalizeErrorImpl` (friendly mapped error), not raw provider JSON.
- [x] 2.8 Write + pass an export AbortSignal test: `downloadFile({ signal })` for an exportable subtype forwards `signal` into the `files.export` call; aborting mid-stream errors the returned stream (AbortError / normalized `tag:"cancelled"`) and no further bytes flow.
- [x] 2.9 Write + pass an export mid-stream error test: the `files.export` response stream erroring mid-flight is forwarded through the byte-counting `Transform` (source `error` listener) and surfaces normalized to the consumer (so fs-sync's env-retry can classify it).
- [x] 2.10 Add the contract-suite coverage: assert the export branch in `googledrive-client.contract.test.ts` via a Drive-specific export fixture/responder (S3/OneDrive have no Google Apps notion — Drive-only arm).

## 3. Engine↔renderer drift guard

- [ ] 3.1 Write a failing drift-guard test asserting every `GOOGLE_APPS_EXPORT_FORMATS` entry is exportable by the engine (routes via `files.export` with the entry's `exportMime`) AND, via a representative `FileEntry` (mime in `providerMetadata.mimeType`), produces the entry's `extension` on the renderer side — i.e. the guard exercises both execution paths, not just table self-consistency — and that a mime absent from the const is exportable by neither.
- [ ] 3.2 Ensure both consumers derive exportability/extension from the single const (no hard-coded duplicate list on either side). Make 3.1 pass.

## 4. Renderer — append export extension

- [ ] 4.1 Write failing orchestrator tests in `use-download-orchestrator.test.ts`. All exportable-entry fixtures put the provider mime in `providerMetadata.mimeType` (NOT `entry.mimeType`, which the mapper hardcodes to `null`): (a) a `google-apps.document` entry composes `toPath` from basename `"<name>.docx"`; (b) append-always edge — `name: "Notes.txt"` → `"Notes.txt.docx"`; (c) each exportable subtype appends its mapped extension; (d) a binary entry uses `entry.name` unchanged; (e) the Save-as `defaultPath` uses the extended basename when the dialog is shown; (f) a non-exportable Google Apps mime (Form) appends nothing and dispatches with `entry.name`; (g) a `providerMetadata.mimeType` that is absent or non-string appends nothing and dispatches with `entry.name` (no crash).
- [ ] 4.2 In `use-download-orchestrator.ts` `dispatchAgainstFolder`, derive the effective basename: read `entry.providerMetadata.mimeType` with a `typeof === "string"` guard; when that string is a key in `GOOGLE_APPS_EXPORT_FORMATS`, use `entry.name + GOOGLE_APPS_EXPORT_FORMATS[mime].extension`; else `entry.name`. Do NOT read `entry.mimeType` (always null). Pass the effective basename to `joinFolderAndName` and the Save-as `defaultPath`. No extension parsing of the title. Make 4.1 pass.
- [ ] 4.3 Confirm `scripts/no-extension-parsing.test.ts` still passes (the new code uses no `lastIndexOf(".")`).

## 5. Verification

- [ ] 5.1 `pnpm --filter @ft5/fs-datasource-engine test` green (export branch + refusal + binary regression + contract).
- [ ] 5.2 `pnpm --filter @ft5/ipc-contracts test` + renderer file-explorer tests green (orchestrator + drift guard).
- [ ] 5.3 Typecheck (`tsc -b`) + lint clean across touched packages; engine, ipc-contracts, and desktop renderer.
- [ ] 5.4 Full repo test suite green (or only the known pre-existing flakes per memory: `scripts/render-budget.test.tsx` load-induced; `authenticate-flow` S3 `vi.mock` main-checkout flake).
- [ ] 5.5 `openspec validate add-drive-docs-editors-export --strict` green.
- [ ] 5.6 Reactive/forward audit: confirm the spec delta is purely `## ADDED` (no canonical refusal requirement existed to REMOVE) and the four-piece IPC rule does not apply (no wire field added).

## 6. Manual smoke (deferred — PENDING_TC.MD)

- [ ] 6.1 Against a real Drive datasource in the dev build, download one of each exportable subtype (Doc/Sheet/Slide/Drawing/Script) → confirm the file saves with the right extension and opens in the target app. (HUMAN-only; gated on `add-drive-oauth-browser-consent §1` real credentials. Record in PENDING_TC.MD with pointers to the unit tests above.)
- [ ] 6.2 Download a Google Form against the dev build → confirm the friendly `unsupported` toast still appears. (HUMAN-only; same gate.)
