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

- [x] 5.1 `/opsx:sync` applied the datasources-ui delta to canonical (intelligent merge): MODIFIED "UI foundation" (CloudStash Monochrome light/dark themes, no legacy Serene Blue + new "no legacy theme" scenario) + ADDED "CloudStash brand identity — monochrome palette, flat accent, mark, display type".
- [x] 5.2 **Direct-edited** canonical `datasources-ui` `## Purpose`: retired the "Serene Blue themes" mention → "CloudStash Monochrome light/dark (dark canonical), silver-monochrome accent, Bricolage Grotesque display over Geist" (delta lifecycle cannot reach Purpose — same as change 1 Decision 12).
- [x] 5.3 `openspec validate datasources-ui --type spec` green. No LIVE serene references — remaining mentions are the spec's own absence-requirement/scenario (forbidding it) + the change's retirement narrative + tests asserting absence.

## 6. Verify

- [x] 6.1 Contrast test authored (`styles/__tests__/contrast.test.ts` — parses oklch tokens → linear sRGB → WCAG relative luminance): primary button, focus ring, body + muted text vs background AND card meet AA in BOTH themes (11/11). Caught + fixed the one sub-AA pair: light `--muted-foreground` 4.42 → 4.94 on the canvas (commit `96580db`).
- [x] 6.2 Guards green: colour-literal ban (in suite) + motion-budget + no-blur — `pnpm lint` exit 0; no new motion/blur added.
- [x] 6.3 `pnpm typecheck` exit 0 + `pnpm lint` exit 0 + full `pnpm -w test` = **3194 pass** (1 pre-existing `channels.test-d` load flake, passes isolated — PENDING_TC) + `pnpm -r build` (renderer next + electron-vite + services) exit 0, on `pnpm abi:node`. **DEFERRED to PENDING_TC:** running-system first-paint monochrome screenshot / theme-swap visual (needs a live Electron app; the no-FOUC guarantee is structurally unit-tested via `no-fouc.test.tsx`, and the monochrome look was visually validated via the approved refinement mockup).
- [x] 6.4 `openspec validate restyle-cloudstash-monochrome` green.
