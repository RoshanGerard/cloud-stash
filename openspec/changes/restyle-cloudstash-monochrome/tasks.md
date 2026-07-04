## 1. Pre-flight (post-rename dependency)

- [ ] 1.1 Confirm `rebrand-to-cloudstash` merged; worktree at `.worktrees/restyle-cloudstash-monochrome/` off post-rename `master`; `pnpm install`.
- [ ] 1.2 Pre-apply staleness check: `globals.css`, `cloudstash-logo.tsx`, `app-header.tsx`, the `cloudstash.*` theme key, and `next/font` wiring still match `design.md`.

## 2. Visual-refinement pass (MANDATORY GATE — before any restyle code)

- [ ] 2.1 Run `superpowers:brainstorming` visual-refinement (Visual Companion): resolve the ONE open fork — radii/density reconciliation (design.md Open Questions) — and produce browser mockups of the dashboard + a card + the header in CloudStash Monochrome (dark + light).
- [ ] 2.2 Record the resolution in `design.md` `## Visual direction`; if the pack-radii alternative is chosen, add the MODIFIED "Visual direction" delta to `specs/datasources-ui/spec.md` and re-run `openspec validate` before proceeding.

## 3. Palette rebuild (globals.css)

- [ ] 3.1 Rebuild `.dark` as canonical CloudStash graphite (canvas `#080F14`, surface ramp, silver text ramp) and `:root` as monochrome light — as `oklch()`, every shadcn token name preserved.
- [ ] 3.2 Remove the `[data-theme="serene-blue"]` block and the crimson `--brand-primary` token; set accent/ring to silver; primary button → inverted silver on ink.
- [ ] 3.3 Drop any Serene Blue option from the theme switcher code.

## 4. Brand mark + display type

- [ ] 4.1 Swap `CloudStashLogo` artwork: theme-swapped `mark-dark.svg` / `mark-light.svg` (fixed multi-gradient, not token-tinted) + a `currentColor` `glyph.svg` for 16–32px; wire theme swap.
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
