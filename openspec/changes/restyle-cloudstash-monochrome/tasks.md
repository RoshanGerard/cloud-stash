## 1. Pre-flight (post-rename dependency)

- [x] 1.1 `rebrand-to-cloudstash` merged (`9fc1aa0`); worktree at `.worktrees/restyle-cloudstash-monochrome/` off post-rename `master` (rebased → `da4f02f`); `pnpm install` DONE (exit 0).
- [x] 1.2 Pre-apply staleness check DONE: MODIFIED header matches canonical `datasources-ui:194`; `--brand-primary` consumers = `globals.css` + `cloudstash-logo.tsx:78` only; Serene Blue surface mapped (design Decision 6); `cloudstash.theme` key present (`theme-store.ts:26`); Geist `next/font` wired. All match `design.md`.

## 2. Visual-refinement pass (MANDATORY GATE — before any restyle code)

- [x] 2.1 Visual-refinement pass DONE — interactive mockup (theme + radii toggle on the real dashboard: header + dense `DatasourceCard`s in connected/syncing/paused/error/usage states, dark + light). Resolved the one open fork (radii/density) and surfaced the flat-primary-button refinement.
- [x] 2.2 Resolution recorded in `design.md` `## Visual direction`: **dense-quiet radii retained → "Visual direction" requirement UNCHANGED, NO MODIFIED delta**. Advisor-flagged spec reword applied to the ADDED requirement (per-theme accent: silver-on-dark / graphite-on-light; flat inverted-monochrome primary); `openspec validate` green.

## 3. Palette rebuild (globals.css)

- [x] 3.1 Rebuilt `.dark` as canonical CloudStash graphite + `:root` as monochrome light — oklch, every shadcn token name preserved (commit `8887ac9`).
- [x] 3.2 Removed the `[data-theme="serene-blue"]` block; accent/ring → silver (dark) / graphite (light); primary button → FLAT inverted silver/ink (commit `8887ac9`). The crimson `--brand-primary` token was RETAINED in §3 (logo still used it) and removed in §4.1 (commit `7f4ab1b`).
- [x] 3.3 Retired Serene Blue across the FULL surface — `globals.css` block, `theme-switcher.tsx` option+`case`, `theme-store.ts` union+parse/apply, `theme-script.ts` bootstrap branch, `sonner.tsx` mapping, `icon.tsx` `droplets` (removed, was unused). `monochrome-identity.test.ts` + rewritten theme-switcher/no-fouc tests (commit `8887ac9`).

## 4. Brand mark + display type

- [x] 4.1 Swapped `CloudStashLogo` to theme-swapped `mark-dark`/`mark-light` `<img>` (in `public/brand/`, `.dark`-variant toggle, FOUC-free) + inline `currentColor` `CloudStashGlyph` for 16–32px; removed `--brand-primary`; rewrote `cloudstash-logo.test.tsx` + added the no-crimson palette-scan test; build smoke green (commit `7f4ab1b`; a11y decision recorded `bf86e84`).
- [x] 4.2 Favicon wired: CloudStash app-tile SVG vendored to `public/brand/cloudstash-app-tile-dark.svg` + `metadata.icons` in `layout.tsx` (served via `app://`, root-relative); regression guard `app/__tests__/favicon.test.ts`. NO rasteriser dep added. **DEFERRED to PENDING_TC:** rasterised OS icon pack (ico/icns/png) + electron-builder `icon:` wiring + tray icon — packaged-build-only, needs a rasteriser + packaged verification (SVG sources ship in `public/brand/`).
- [x] 4.3 Added Bricolage Grotesque via `next/font/local` (vendored `@fontsource-variable/bricolage-grotesque` woff2 → `src/fonts/bricolage/`, self-hosted, OFL); applied `font-display` to wordmark + `DialogTitle` + dashboard `<h1>` + explore `<h2>`; kept Geist Sans/Mono; `typography.test.ts` + build smoke confirm self-hosted, zero runtime fetch (commit `027bf0d`).

## 5. Spec sync + Purpose direct-edit

- [ ] 5.1 Drift guard + `/opsx:sync` (1 MODIFIED + 1 ADDED to datasources-ui).
- [ ] 5.2 **Direct edit** `datasources-ui` `## Purpose` prose: retire the "Serene Blue themes" mention and reflect the monochrome identity (delta lifecycle cannot reach Purpose — same as change 1 Decision 12).
- [ ] 5.3 `openspec validate datasources-ui --type spec` green; `git grep -i serene` returns nothing outside archive.

## 6. Verify

- [ ] 6.1 Contrast test: primary button, accent/focus ring, body + muted text vs backgrounds meet WCAG AA in BOTH themes (muted-on-surface is the risk pair).
- [ ] 6.2 Existing guards green: colour-literal ban, motion-budget (`scripts/motion-budget`), no-blur-outside-overlays.
- [ ] 6.3 Full suite: `pnpm typecheck` + `pnpm lint` + `pnpm test` (`pnpm abi:node`) + e2e; first-paint dark screenshot shows CloudStash monochrome, no theme flash.
- [ ] 6.4 `openspec validate restyle-cloudstash-monochrome` green.
