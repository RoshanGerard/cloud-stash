## 1. Wire contract (`packages/ipc-contracts`)

- [ ] 1.1 (test, watch it fail) In `src/sync-service/__tests__/list-leftover.test-d.ts`, assert `LeftoverEntry` carries a required `status: LeftoverStatus`; assert `"completed"` is NOT assignable to it; assert the three KEEP-eligible values ARE assignable.
- [ ] 1.2 In `src/sync-service/commands.ts`, declare `export type LeftoverStatus = Exclude<DownloadTerminalStatus, "completed">` beside the existing `DownloadTerminalStatus`, with a doc comment stating why it is derived rather than duplicated (design.md Decision 2).
- [ ] 1.3 Add the required `readonly status: LeftoverStatus` field to `LeftoverEntry` and update that interface's doc comment to describe it.
- [ ] 1.4 Thread `LeftoverStatus` through the existing export chain so the renderer can import it: `sync-service/index.ts` → `sync-service-desktop/requests.ts` → `sync-service-desktop/index.ts` (mirror exactly how `LeftoverEntry` is already re-exported at each site).
- [ ] 1.5 Confirm 1.1 now passes and `pnpm --filter @cloudstash/ipc-contracts test` is green.

## 2. Service handler (`services/fs-sync`)

- [ ] 2.1 (test, watch it fail) In `src/commands/downloads-list-leftover.test.ts`, seed one `failed`, one `cancelled`, and one `interrupted` row with on-disk partials; assert each returned entry's `status` equals its own row's stored status.
- [ ] 2.2 (test) Seed a `cancelled` row whose `failure_tag` and `failure_message` are both `NULL`; assert the entry still carries `status: "cancelled"` (required, never omitted).
- [ ] 2.3 In `src/commands/downloads-list-leftover.ts`, add `status` to the `SELECT` column list (it currently appears only in the `WHERE`) and to the `LeftoverRow` interface as `string`.
- [ ] 2.4 Project `status` onto the pushed entry, narrowing the untyped column with a cast whose comment cites the query's own `WHERE status IN (...)` as the guarantee (design.md Decision 4). Do NOT add a runtime guard.
- [ ] 2.5 Confirm the existing exclusion/ordering/`stat`-skip tests still pass unchanged — filtering, ordering, and the never-throws contract must be untouched.

## 3. Main-process IPC bridge (`apps/desktop`)

- [ ] 3.1 (test) In `src/main/ipc/sync/__tests__/list-leftover.test.ts`, assert a `status` on a service-returned entry survives the bridge to the renderer-facing response.
- [ ] 3.2 Inspect `src/main/ipc/sync/list-leftover.ts`: if it forwards the response wholesale, no code change is needed and 3.1 documents the passthrough; if it projects fields explicitly, add `status` to that projection.

## 4. Renderer dialog (`apps/desktop`)

- [ ] 4.1 (test, watch it fail) In `src/renderer/src/features/settings/__tests__/leftover-files-dialog.test.tsx`, render an entry with `status: "cancelled"` and null tag/message; assert the row's reason names it as cancelled and does NOT contain "Download failed". This is the bug reproduction.
- [ ] 4.2 (test) Assert an `interrupted` entry and a `cancelled` entry (both with null tag/message) render DIFFERENT reasons, each naming its own disposition.
- [ ] 4.3 (test) Assert a `failed` entry with `failureMessage: "ran out of retries"` renders a reason that both identifies it as failed and includes that detail.
- [ ] 4.4 Extract the shared status→label lookup (design.md Decision 6): a `Record<DownloadTerminalStatus, string>` holding the exact strings fixed in design.md `## Visual direction` (VD1), placed alongside the two Settings dialogs that consume it.
- [ ] 4.4a Point `clear-history-dialog.tsx`'s `STATUS_OPTIONS` at the shared lookup for its label strings, leaving its option ORDER and its `completed` entry unchanged; confirm the existing clear-history tests still pass untouched.
- [ ] 4.4b In `leftover-files-dialog.tsx`, index the shared lookup with the entry's `LeftoverStatus` (sound because `LeftoverStatus` is a subset of the lookup's key type — no fallback branch needed).
- [ ] 4.5 Restructure `reasonLine` to the `<status label> · [detail] · <when>` shape and DELETE the `"Download failed"` fallback — with `status` required no row can be unlabelled (design.md Decision 3).
- [ ] 4.6 Update the `DialogDescription` copy so it no longer characterizes the whole list as "failed downloads" (design.md Decision 5), using the wording fixed in `## Visual direction`.
- [ ] 4.7 Confirm the existing dialog tests (empty state, per-row delete, bulk delete aggregate, focus restoration) all still pass unchanged.

## 5. Verification and close-out

- [ ] 5.1 Full suite green: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.
- [ ] 5.2 `openspec validate add-leftover-entry-status --strict` is green.
- [ ] 5.3 Exercise against a running app: produce a cancelled download, open Settings → Review leftover files, and confirm the row reads as cancelled rather than failed.
- [ ] 5.4 Verify accessibility is unregressed — the reason line remains readable text in the row's accessible name/description, and contrast on the muted reason text still meets WCAG AA.
- [ ] 5.5 Archive via `/opsx:archive` on the worktree branch, then hand off through `finishing-a-development-branch`.
