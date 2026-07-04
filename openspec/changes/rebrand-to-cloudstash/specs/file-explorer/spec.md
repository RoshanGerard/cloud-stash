## MODIFIED Requirements

### Requirement: Download success toast presents Open and Show-in-folder actions

A successful download SHALL surface a Sonner toast with the file name,
a primary CTA "Open" (filled blue button), and a secondary text link
"Show in folder". The toast SHALL auto-dismiss after the same timer used
by the upload-success toast. Activating "Open" SHALL invoke
`shell.openPath(savedPath)` via a new preload exposure
`window.api.files.openSavedPath(savedPath)`. Activating "Show in folder"
SHALL invoke `shell.showItemInFolder(savedPath)` via
`window.api.files.showSavedInFolder(savedPath)`.

The toast SHALL be a Sonner `toast.custom()` rendering with the layout:

```
┌───────────────────────────────────────────────────┐
│ ✓ Downloaded <fileName>                           │
│                                                   │
│         Show in folder         [    Open    ]     │
└───────────────────────────────────────────────────┘
```

In-flight: a Sonner toast SHALL display "Downloading <fileName>" with a
progress bar and an X to cancel. On `download-failed`: the toast SHALL
flip to red (using Sonner's per-toast `richColors: true` override) with
"Download failed: <message>" and a Retry action button that re-dispatches
the original request from byte 0. On `download-cancelled`: the toast
SHALL be dismissed silently.

#### Scenario: Successful download surfaces Open + Show in folder

- **WHEN** a download completes (the IPC reply is `{ ok: true, value: { savedPath: "/Users/alice/Downloads/CloudStash/welcome.pdf", bytes: 12345 } }`)
- **THEN** the in-flight toast updates to the success variant with the file name "welcome.pdf", a quieter "Show in folder" link, and a primary "Open" button; the toast auto-dismisses after the upload-toast success duration

#### Scenario: Open invokes shell.openPath

- **WHEN** the user clicks "Open" on the success toast
- **THEN** the renderer calls `window.api.files.openSavedPath("/Users/alice/Downloads/CloudStash/welcome.pdf")`; the preload routes to a main-process IPC that invokes `shell.openPath(savedPath)`; the toast dismisses

#### Scenario: Show in folder invokes shell.showItemInFolder

- **WHEN** the user clicks "Show in folder"
- **THEN** the renderer calls `window.api.files.showSavedInFolder(savedPath)`; the main-process IPC invokes `shell.showItemInFolder(savedPath)`; the toast dismisses

#### Scenario: Download failure shows Retry

- **WHEN** a download fails (IPC reply `{ ok: false, error: { tag: "auth-revoked" | "other" | …, message } }`)
- **THEN** the toast flips to red with copy "Download failed: <message>"; a Retry action button is present; activating Retry re-dispatches `window.api.files.download` with the original parameters and opens a new toast bound to the new downloadJobId

### Requirement: First-run downloads modal collects the default folder

The renderer SHALL render a blocking modal on the user's first-ever
download attempt (detected by absence of the `cloudstash.downloads.defaultFolder`
key in the renderer's preferences store). The modal SHALL:

- Render via the shadcn `Dialog` primitive (modal, focus-trapped,
  Escape-disabled — the user must commit a folder).
- Display title "Where should downloads go?" and body "Choose a default
  folder. You can change this later in Settings or use 'Save as…' to
  pick per file."
- Pre-fill the path input with the OS default downloads folder
  (`app.getPath("downloads")` joined with `"CloudStash"`, e.g.
  `~/Downloads/CloudStash` on Unix).
- Provide a "Browse…" button that opens
  `dialog.showOpenDialog({ properties: ['openDirectory',
  'createDirectory'] })` and updates the path input on selection.
- Provide a single primary CTA "Use this folder" which persists the
  chosen folder via `window.api.preferences.setDefaultDownloadsFolder(folder)`
  (the preload exposes a thin shim around the localStorage write so the
  main process can persist via its own mechanism if v2 evolves the
  storage layer; v1 is renderer-only).
- Provide NO Skip / Close affordance. The modal closes only when the
  user confirms.

After the modal closes, the deferred download dispatches automatically
to the now-set default folder.

#### Scenario: First-ever download triggers the modal

- **WHEN** the user clicks Download on a file entry, the localStorage key `cloudstash.downloads.defaultFolder` is absent
- **THEN** the file-explorer renders `<FirstDownloadModal>` with the OS default downloads folder pre-filled; no IPC dispatch occurs yet

#### Scenario: Modal commit persists default and dispatches the deferred download

- **WHEN** the user accepts the pre-filled `~/Downloads/CloudStash` and clicks "Use this folder"
- **THEN** the localStorage key `cloudstash.downloads.defaultFolder` is set to the chosen path; the modal closes; the originally-clicked download is dispatched against that path; a Sonner toast opens for the in-flight download

#### Scenario: Modal cannot be dismissed without commit

- **WHEN** the modal is open and the user presses Escape or clicks the backdrop
- **THEN** the modal does not close; the focus remains trapped inside; the deferred download remains queued

### Requirement: Settings dialog includes a Downloads section

The `SettingsDialog` SHALL gain a "DOWNLOADS" section containing two rows. The existing dialog currently contains only the Motion section; the new section sits as a sibling. The two rows are:

- **Default folder**: label, current path display (truncated with
  ellipsis on long paths), Open button, Change… button. Open invokes
  `shell.showItemInFolder(folder)` via a new preload exposure. Change…
  opens `dialog.showOpenDialog({ properties: ['openDirectory',
  'createDirectory'] })` and updates the stored value on selection.

- **Always ask where to save**: label "Always ask where to save", body
  "Show the Save-as dialog for every download.", a Switch (the same
  shadcn `Switch` primitive used by the Motion row).

The section SHALL be implemented as a sibling of the existing Motion
section in `settings-dialog.tsx`, using the same heading-and-row
typography. The section SHALL be reachable via Tab from the Motion
row's Switch and SHALL trap focus consistently with the existing
modal behavior.

#### Scenario: Default folder display matches stored preference

- **WHEN** the user opens Settings and the localStorage key `cloudstash.downloads.defaultFolder` is set to `/Users/alice/Downloads/CloudStash`
- **THEN** the Default folder row displays `/Users/alice/Downloads/CloudStash` (truncated if long), an Open button, and a Change… button

#### Scenario: Change… updates the default folder

- **WHEN** the user clicks Change…, picks `/Users/alice/cloud-files` from the OS picker, and confirms
- **THEN** the localStorage key updates to `/Users/alice/cloud-files`; the row's path display updates immediately; subsequent downloads (with no Shift modifier and Always-ask off) target the new folder

#### Scenario: Always-ask toggle enables per-download save dialog

- **WHEN** the user toggles "Always ask where to save" to on
- **THEN** the localStorage key `cloudstash.downloads.alwaysAsk` is set to `"yes"`; the next Download click triggers `dialog.showSaveDialog` for the per-download path; the default folder is the dialog's starting location

### Requirement: Downloads preferences resolve `toPath` from store + modifier keys

The renderer SHALL maintain a `downloads-store` at
`apps/desktop/src/renderer/src/features/settings/downloads-store.ts`
modeled on the existing `motion-store.ts` pattern: `useSyncExternalStore`
hook, `localStorage` persistence, no main-process write-through. Stored
keys:

- `cloudstash.downloads.defaultFolder`: absolute folder path string. Absent
  if not yet set; first download triggers the modal that sets it.
- `cloudstash.downloads.alwaysAsk`: `"yes"` (toggle on) or absent (toggle off).
  No `"no"` representation; key absence is the default.

The download orchestrator SHALL compute `toPath` for each download as:

1. If the click event carries `shiftKey: true` OR `alwaysAsk === "yes"`,
   open `dialog.showSaveDialog` (default value
   `<defaultFolder>/<fileName>`) and use the returned path. If the user
   cancels the save dialog, the download is NOT dispatched.
2. Otherwise, set `toPath = <defaultFolder>/<fileName>`. If the local
   file already exists at that path, the OS-level overwrite handling
   is delegated to `dialog.showSaveDialog` only when triggered (i.e.,
   step 1). Step 2 silently overwrites — matching browser-default
   behavior for "auto-save to folder" downloads.

#### Scenario: Default folder path resolution

- **WHEN** the default folder is `/Users/alice/Downloads/CloudStash`, Always-ask is off, no Shift modifier, and the user downloads `welcome.pdf`
- **THEN** `toPath` is computed as `/Users/alice/Downloads/CloudStash/welcome.pdf`; the download dispatches against that path

#### Scenario: Shift+Click forces Save-as

- **WHEN** the user Shift+Clicks Download on `welcome.pdf` (default folder is set, Always-ask is off)
- **THEN** `dialog.showSaveDialog` opens with default value `<defaultFolder>/welcome.pdf`; if the user picks `/tmp/welcome.pdf`, the download dispatches against that path; if the user cancels, no IPC dispatch occurs

#### Scenario: Always-ask routing

- **WHEN** Always-ask is on and the user clicks Download (no Shift)
- **THEN** the orchestrator behaves as if Shift+Click had occurred: `dialog.showSaveDialog` opens; on confirm, the download dispatches; on cancel, no dispatch

### Requirement: Settings dialog includes an Explorer section with a Page-size dropdown

The `SettingsDialog` SHALL gain an "Explorer" section sitting between the existing Motion section and the existing Downloads section (top-down: General → Browsing → File-handling). The section SHALL use the same `<h3 className="text-sm font-semibold">` heading + flex-row pattern as Downloads' "Default folder" row.

The section SHALL contain one row: a left-side stack with a `text-xs font-medium` label `Items loaded per page` and a `text-muted-foreground text-xs` description `Larger values fetch more per click; smaller values paint faster on first load.`, plus a right-side dropdown control. The control SHALL be a `<DropdownMenu>` whose `<DropdownMenuTrigger>` is a `<Button variant="outline" size="sm">` showing the current value (with comma separators on values ≥ 1000) and a trailing `<ChevronDown className="size-3" />`. The button SHALL carry `aria-label="Items loaded per page"` so the trigger is announced even before the menu opens.

The `<DropdownMenuContent>` SHALL render with `align="end"`, lead with a `<DropdownMenuLabel className="text-muted-foreground text-xs uppercase tracking-wider">Page size</DropdownMenuLabel>`, and contain a `<DropdownMenuRadioGroup>` with five `<DropdownMenuRadioItem>` entries: `100`, `500`, `1,000`, `5,000`, `10,000` (display text uses comma separators for values ≥ 1000; the underlying string value is the un-formatted integer). All digit displays SHALL use `tabular-nums`.

The selected value SHALL be persisted to the localStorage key `cloudstash.explorer.pageSize` (mirroring the `cloudstash.downloads.*` pattern) and SHALL default to `500` on first read. The selected value SHALL be passed as `pageSize` on every `files:list` call originating from the file-explorer (initial page-load and Load-more alike). Changing the setting SHALL NOT auto-refresh the current view; the new value applies to the next list call.

The codebase SHALL NOT introduce a shadcn `Select` primitive for this row — the `DropdownMenu` + `DropdownMenuRadioGroup` pattern matches the existing toolbar View-mode menu (`apps/desktop/src/renderer/src/features/file-explorer/toolbar.tsx`) and avoids a net-new primitive.

#### Scenario: Default page size is 500 on first launch

- **WHEN** the renderer launches with no value at `cloudstash.explorer.pageSize` and the user opens Settings
- **THEN** the Explorer section's Page-size trigger button shows `500` as the current value; the next `files:list` request emitted by the file-explorer carries `pageSize: 500`

#### Scenario: Changing page size persists and applies to the next list call

- **WHEN** the user opens Settings, opens the Page-size dropdown, selects `1,000`, closes the dialog, then navigates to a new folder
- **THEN** the localStorage key `cloudstash.explorer.pageSize` is `"1000"` (no comma in the persisted value); the trigger button now shows `1,000`; the next `files:list` request carries `pageSize: 1000`; the previously rendered folder is NOT re-fetched

#### Scenario: Page size dropdown is keyboard-reachable and labeled

- **WHEN** the user tabs through the Settings dialog with the Explorer section visible
- **THEN** the Page-size trigger button receives focus with the standard 3px focus ring; it has accessible name `Items loaded per page`; activating it (Enter or Space) opens the menu; arrow keys move through `100`, `500`, `1,000`, `5,000`, `10,000`; Enter selects; Escape closes the menu without changing the value

#### Scenario: Active value is indicated in the menu

- **WHEN** the dropdown is open with the persisted value at `500`
- **THEN** the `500` `<DropdownMenuRadioItem>` shows a check icon to its left (the standard `DropdownMenuRadioItem` indicator); the other four entries do not; the menu's leading `<DropdownMenuLabel>` reads `Page size` in uppercase, `tracking-wider`, `text-muted-foreground`
