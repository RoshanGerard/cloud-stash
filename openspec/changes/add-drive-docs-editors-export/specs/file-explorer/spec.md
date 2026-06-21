## ADDED Requirements

### Requirement: Download orchestrator appends the export extension for Google Apps files

When the renderer download orchestrator dispatches a download for a `FileEntry` whose provider mime is an exportable Google Apps subtype, it SHALL append that subtype's `extension` to the saved filename's basename **before** composing `toPath` (via `joinFolderAndName` / `sanitizeFilenameForOS`) and before populating the Save-as dialog's `defaultPath`. Because Google Apps titles carry no extension, this is how the saved file lands as `<title>.docx` / `.xlsx` / `.pptx` / `.png` / `.json`.

The provider mime SHALL be read from `entry.providerMetadata.mimeType` with a string type-guard — NOT from `entry.mimeType`, which the fs-sync entry mapper hardcodes to `null` for every provider. The lookup key is that string against `GOOGLE_APPS_EXPORT_FORMATS`.

The policy is **append-always**: the orchestrator concatenates `entry.name + extension` and MUST NOT parse, split, or strip the existing title (a Google Doc literally titled `Notes.txt` is saved as `Notes.txt.docx`). The orchestrator MUST NOT use `lastIndexOf(".")` or any other extension-parsing on the title (per the renderer `scripts/no-extension-parsing.test.ts` guardrail). When the provider mime is absent, non-string, or not an exportable Google Apps subtype (binary files, and non-exportable Google Apps mimes such as Forms), the orchestrator SHALL use `entry.name` unchanged.

#### Scenario: Google Doc saved filename gets the .docx extension

- **WHEN** the user downloads a `FileEntry` with `providerMetadata.mimeType: "application/vnd.google-apps.document"` and `name: "Quarterly Report"` to the default folder
- **THEN** the orchestrator composes `toPath` from the basename `"Quarterly Report.docx"` (and the Save-as `defaultPath`, when shown, uses the same basename)

#### Scenario: append-always never strips an extension-shaped title

- **WHEN** the user downloads a `FileEntry` with `providerMetadata.mimeType: "application/vnd.google-apps.document"` and `name: "Notes.txt"`
- **THEN** the saved basename is `"Notes.txt.docx"` (the title is never parsed or stripped)

#### Scenario: each exportable subtype appends its mapped extension

- **WHEN** the user downloads a `spreadsheet`, `presentation`, `drawing`, or `script` Google Apps entry (provider mime in `providerMetadata.mimeType`)
- **THEN** the saved basename ends in `.xlsx`, `.pptx`, `.png`, or `.json` respectively, taken from `GOOGLE_APPS_EXPORT_FORMATS`

#### Scenario: binary file basename is unchanged

- **WHEN** the user downloads a binary `FileEntry` (e.g. `providerMetadata.mimeType: "application/pdf"`, `name: "report.pdf"`)
- **THEN** the orchestrator uses `entry.name` unchanged — no extension is appended

#### Scenario: absent or non-string provider mime appends nothing

- **WHEN** the user downloads a `FileEntry` whose `providerMetadata.mimeType` is missing or not a string (and whose always-null `entry.mimeType` therefore cannot help)
- **THEN** the orchestrator appends no extension and dispatches with `entry.name` unchanged — no crash

#### Scenario: non-exportable Google Apps entry appends nothing and surfaces the engine refusal

- **WHEN** the user downloads a Google Form (`providerMetadata.mimeType: "application/vnd.google-apps.form"`)
- **THEN** the orchestrator appends no extension (the mime is absent from `GOOGLE_APPS_EXPORT_FORMATS`) and dispatches with `entry.name`; the engine's `tag: "unsupported"` refusal flows back and the existing error toast renders
