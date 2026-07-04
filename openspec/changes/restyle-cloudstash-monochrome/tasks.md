## 1. Pre-flight (post-rename dependency)

- [x] 1.1 `rebrand-to-cloudstash` merged (`9fc1aa0`); worktree at `.worktrees/restyle-cloudstash-monochrome/` off post-rename `master` (rebased → `da4f02f`); `pnpm install` DONE (exit 0).
- [x] 1.2 Pre-apply staleness check DONE: MODIFIED header matches canonical `datasources-ui:194`; `--brand-primary` consumers = `globals.css` + `cloudstash-logo.tsx:78` only; Serene Blue surface mapped (design Decision 6); `cloudstash.theme` key present (`theme-store.ts:26`); Geist `next/font` wired. All match `design.md`.

## 2. Visual-refinement pass (MANDATORY GATE — before any restyle code)

- [x] 2.1 Visual-refinement pass DONE — interactive mockup (theme + radii toggle on the real dashboard: header + dense `DatasourceCard`s in connected/syncing/paused/error/usage states, dark + light). Resolved the one open fork (radii/density) and surfaced the flat-primary-button refinement.
- [x] 2.2 Resolution recorded in `design.md` `## Visual direction`: **dense-quiet radii retained → "Visual direction" requirement UNCHANGED, NO MODIFIED delta**. Advisor-flagged spec reword applied to the ADDED requirement (per-theme accent: silver-on-dark / graphite-on-light; flat inverted-monochrome primary); `openspec validate` green.

## 3. Palette rebuild (globals.css)

- [ ] 3.1 Rebuild `.dark` as canonical CloudStash graphite (canvas `#080F14`, surface ramp, silver text ramp) and `:root` as monochrome light — as `oklch()`, every shadcn token name preserved.
- [ ] 3.2 Remove the `[data-theme="serene-blue"]` block and the crimson `--brand-primary` token; set accent/ring to silver; primary button → inverted silver on ink.
- [ ] 3.3 Retire Serene Blue across the FULL surface (design Decision 6): `globals.css` block; `theme-switcher.tsx` option + `case`; `theme-store.ts` `ThemePreference` union + parse/apply; `theme-script.ts` bootstrap branch; `sonner.tsx` mapping; `icon.tsx` `droplets` (if now unused). Plus tests for "no theme beyond Light/Dark/System".

## 4. Brand mark + display type

- [ ] 4.1 Swap `CloudStashLogo` artwork: pack ships `cloudstash-mark-dark.svg` / `cloudstash-mark-light.svg` / `cloudstash-glyph.svg` / `cloudstash-app-tile-dark.svg` (confirmed present — a swap, not authoring). Theme-swapped mark + `currentColor` glyph for 16–32px; mark hex stays in `.svg` files (not `.tsx` — literal-ban). Rewrite `cloudstash-logo.test.tsx` (asserts crimson fill).
- [ ] 4.2 Generate favicon / tray / OS icons from the mark/app-tile (justify `sharp`/packer dep in design.md if added).
- [ ] 4.3 Add Bricolage Grotesque via `@fontsource`/`next/font` (self-hosted, OFL); apply to wordmark + headings; keep Geist Sans (UI) + Geist Mono (mono). Verify no runtime font fetch.

## 5. Spec sync + Purpose direct-edit

- [ ] 5.1 Drift guard + `/opsx:sync` (1 MODIFIED + 1 ADDED to datasources-ui).
- [ ] 5.2 **Direct edit** `datasources-ui` `## Purpose` prose: retire the "Serene Blue themes" mention and reflect the monochrome identity (delta lifecycle cannot reach Purpose — same as change 1 Decision 12).
- [ ] 5.3 `openspec validate datasources-ui --type spec` green; `git grep -i serene` returns nothing outside archive.

## 6. Verify

- [ ] 6.1 Contrast test: primary button, accent/focus ring, body + muted text vs backgrounds meet WCAG AA in BOTH themes (muted-on-surface is the risk pair).
- [ ] 6.2 Existing guards green: colour-literal ban, motion-budget (`scripts/motion-budget`), no-blur-outside-overlays.
- [ ] 6.3 Full suite: `pnpm typecheck` + `pnpm lint` + `pnpm test` (`pnpm abi:node`) + e2e; first-paint dark screenshot shows CloudStash monochrome, no theme flash.
- [ ] 6.4 `openspec validate restyle-cloudstash-monochrome` green.
