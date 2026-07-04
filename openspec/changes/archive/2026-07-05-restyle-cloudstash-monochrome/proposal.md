## Why

With the rename landed (`rebrand-to-cloudstash`), CloudStash needs its actual visual identity: the **CloudStash Monochrome Dark** design system (canvas `#080F14`, layered graphite surfaces, silver accent, status colours only), a real brand mark, and a distinctive display typeface — replacing the crimson-Forti5 `--brand-primary` and the shadcn default palette. This is change 2 of 3 (rename → **restyle** → window-chrome). It is spec-light / impl-heavy: the theme mechanism, three-option switcher, Geist typography, motion whitelist, and WCAG baseline are already specified; this change swaps the *palette values, accent, mark artwork, and display type* and retires the legacy Serene Blue theme. It depends on `rebrand-to-cloudstash` being merged.

## What Changes

- **Monochrome palette** in `globals.css`: rebuild the dark theme as the canonical CloudStash identity (graphite surface ramp, silver text ramp) and rebuild the light theme as a monochrome light (retiring the shadcn-default light). Colour + radius values come from the pack tokens.
- **Retire `--brand-primary` crimson → pure-silver monochrome accent** (focus/active silver `#E6E9EE`, AA-verified; no crimson, no blue). Primary button becomes inverted silver on ink.
- **Retire the legacy "Serene Blue" theme** (code `[data-theme="serene-blue"]` block + Purpose prose) — the switcher already specifies exactly Light / Dark / System.
- **Brand mark**: swap the renamed `CloudStashLogo` artwork from the crimson chevrons to the CloudStash mark, shipped as theme-swapped SVG assets (mark-dark on dark, mark-light on light — a fixed multi-gradient asset, NOT token-tinted) plus a `currentColor` glyph for small sizes (favicon/tray).
- **Display typeface**: add a distinctive OFL display face (**Bricolage Grotesque**, self-hosted via `next/font`) for the wordmark and section headings, keeping Geist Sans as the UI font and Geist Mono for monospace.
- **Depth**: gradient/shadow/glow-faked elevation per the pack (NO new `backdrop-blur` beyond the two already-permitted overlay surfaces); keep the existing `sync-pulse` / `sync-ripple` / `skeleton-shimmer` motion (the pack ships none).
- **OPEN VISUAL FORK (radii/density):** the pack uses softer radii (8–24px); the app's current spec mandates dense-quiet tight radii (≤6px). Recommended resolution (see design.md): keep the dense-quiet radii on routine data surfaces (cards, rows) and reserve larger radii for elevated/overlay surfaces and the mark — adopt the pack's *palette and depth* without loosening information density. To be confirmed in the visual-refinement pass before apply.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `datasources-ui`: MODIFY the UI-foundation requirement so the shipped palette is CloudStash Monochrome (dark canonical) and no legacy theme beyond Light/Dark/System ships; ADD a brand-identity requirement (monochrome palette + silver accent + inverted-silver primary button + theme-swapped mark + OFL display face), WCAG AA in both themes.

## Impact

- **Affected code**: `apps/desktop/src/renderer/src/styles/globals.css` (palette rebuild, remove Serene Blue, remove crimson `--brand-primary`, add display-font var), `cloudstash-logo.tsx` (artwork swap + theme-swapped assets + glyph), `app-header.tsx` wordmark type, `next/font` wiring for the display face, icon-gen for favicon/tray/OS icons from the mark, and the theme switcher (drop any Serene Blue option if present in code).
- **Dependencies**: adds `Bricolage Grotesque` via `@fontsource`/`next/font` (justify in design.md — self-hosted, OFL, no runtime fetch); possibly `sharp`/an icon packer for OS icons (justify if added). Requires `rebrand-to-cloudstash` merged.
- **Out of scope**: window chrome (change 3); a boot splash (optional later); any change to the theme mechanism, motion whitelist, or WCAG baseline (all already spec'd and retained).
