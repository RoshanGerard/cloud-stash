## Context

The renderer's visual system lives in `apps/desktop/src/renderer/src/styles/globals.css`: a `:root` light theme (shadcn slate), a `.dark` cool-near-black theme, a legacy `[data-theme="serene-blue"]` theme, a crimson `--brand-primary` consumed by `CloudStashLogo` (post-rename), Geist Sans/Mono wired via `next/font`, and a custom motion whitelist (`sync-pulse` / `sync-ripple` / `skeleton-shimmer`). The theme mechanism (`.dark` class + inline bootstrap + three-option switcher), the WCAG focus baseline, the colour-literal ban, and the dense-quiet "Visual direction" are already specified in `datasources-ui`. This change replaces the *palette values, accent, brand mark, and display type* with the CloudStash Monochrome Dark identity and retires Serene Blue. The authoritative palette is the design pack at `G:\AI_Research\spec_driven\assets\cloudstash_monochrome_dark_design_pack` (`tokens/cloudstash-theme.json`).

## Goals / Non-Goals

**Goals:**
- The CloudStash Monochrome identity end-to-end: graphite surfaces, silver text/accent, status colours only, a real theme-swapped mark, and a distinctive display face.
- Dark is the canonical brand look; a monochrome Light ships as the alternative; System still respects the OS.
- Retire crimson `--brand-primary` and the Serene Blue theme entirely.
- Preserve everything already spec'd: theme mechanism, three-option switcher, motion whitelist, WCAG AA, colour-literal ban (feature code stays token-driven).

**Non-Goals:**
- No structural/layout change, no new components, no window chrome (change 3).
- No new motion (pack ships none; keep the three existing animations).
- No change to the theme-switching mechanism or the localStorage key contract (that was renamed in change 1).

## Decisions

1. **Palette from the pack tokens, expressed as the existing CSS-variable contract.** The `.dark` block becomes the CloudStash graphite ramp (canvas `#080F14`, surfaces `#12171E`→`#2A323F`, borders `#343D4D`, text `#F2F4F7`→`#8A909A`); `:root` becomes a monochrome light. Values are authored as `oklch()` in `globals.css` (feature code still consumes only `bg-*`/`text-*` token utilities — the literal ban is unchanged). Every shadcn token keeps its variable name so no component churns.
2. **Pure-silver monochrome accent; retire crimson.** `--brand-primary` (crimson) is removed. Focus/active/selection use silver (`#E6E9EE` / accent `#A6ABB5`), AA-verified against the graphite surfaces. No blue (the blue on the pack's styleguide boards is not in the shipped theme CSS). Primary button = inverted silver (`#EEF1F5→#9AA2AE`) on ink (`#0B1016`).
3. **Brand mark ships as fixed theme-swapped SVG assets, not a tinted token.** The CloudStash mark is a multi-gradient 3D cloud + silver seam — it is NOT `currentColor`-tintable, so `CloudStashLogo` stops consuming `--brand-primary` and instead renders `mark-dark.svg` on dark / `mark-light.svg` on light (swapped by theme), plus a `glyph.svg` (`stroke=currentColor`) for 16–32px surfaces (favicon/tray). OS icons are generated from the app-tile SVG.
4. **Display typeface = Bricolage Grotesque (OFL), self-hosted via `next/font`.** Used for the wordmark and section headings; Geist Sans remains the UI/body font and Geist Mono the monospace face. Rationale: a distinctive, contemporary grotesque with character that pairs with Geist's neo-grotesque neutrality, avoids the banned Inter/Roboto/Arial and the pack's licensing-placeholder Inter, and is OFL + self-hostable (no runtime fetch). Alternative considered: Space Grotesk (cleaner/techy but more common) — kept as fallback.
5. **Depth is faked with gradient/shadow/glow, no new glass.** The pack's elevation is shadow/gradient, not blur; `backdrop-blur` stays limited to the two already-permitted overlay surfaces (Dialog scrim, DropdownMenu) per the existing Visual-direction requirement.
6. **Serene Blue retired normatively.** The `[data-theme="serene-blue"]` CSS block and switcher option are removed, and the MODIFIED UI-foundation requirement states no theme beyond Light/Dark/System ships — turning the (previously code-only) retirement into a spec'd contract. The `datasources-ui` `## Purpose` prose that mentions "Serene Blue" is fixed by a tracked direct edit (the delta lifecycle cannot reach Purpose — same mechanism as change 1's Decision 12).

## Risks / Trade-offs

- **[Font dependency]** → `Bricolage Grotesque` added via `@fontsource`/`next/font`, self-hosted, OFL, no runtime fetch — justified here per the no-unjustified-dep rule. If icon generation needs `sharp` as an explicit devDependency, justify at apply.
- **[AA contrast on the graphite ramp]** → silver-on-graphite and muted-text (`#8A909A` / `#5C616C`) must be AA-checked in both themes; the muted-on-surface pairs are the risk. Verified during apply with a contrast test.
- **[Colour-literal ban]** → all new palette values live in `globals.css` only; feature code stays token-driven. The existing literal-ban test guards this.
- **[Post-rename dependency]** → operates on `CloudStashLogo`, `cloudstash.*` theme key, and `@cloudstash/*` — assumes `rebrand-to-cloudstash` merged; pre-apply staleness check confirms.

## Visual direction

Locked from the 2026-07-04 pack brainstorm + delegated decisions:
- **Palette**: CloudStash Monochrome Dark (canonical) + a new monochrome Light. Canvas `#080F14`; surface ramp `#12171E`/`#181E27`/`#202632`/`#2A323F`; borders `#343D4D`; text `#F2F4F7`/`#D1D5DB`/`#B8BDC6`/`#8A909A`; muted `#5C616C`; accent silver `#A6ABB5`/`#E6E9EE`; status `#4ADE80` / `#F59E0B` / `#F87171` / `#60A5FA` only.
- **Accent**: pure monochrome silver; no crimson, no blue.
- **Type**: Bricolage Grotesque (display/wordmark) + Geist Sans (UI) + Geist Mono (mono).
- **Mark**: theme-swapped SVG (dark/light) + currentColor glyph; not token-tinted.
- **Depth/motion**: shadow/gradient/glow depth, no new blur; keep the three existing animations (pack ships none).

## Open Questions

- **Radii / density reconciliation (the one open visual fork).** The pack uses softer radii (sm 8 / md 12 / lg 18 / xl 24px, tile 28%); the current `datasources-ui` "Visual direction" requirement mandates dense-quiet tight radii (routine surfaces ≤ `rounded-md` 6px, no pill/`rounded-full`). **Recommended resolution:** keep the dense-quiet radii on routine data surfaces (cards, list rows, inputs) and reserve the pack's larger radii for elevated/overlay surfaces (Dialog) and the mark/app-tile — i.e. adopt the pack's *palette, accent, mark, and depth* without loosening information density (this app is a dense data tool). Under this resolution the "Visual direction" requirement is unchanged. **Alternative:** adopt the pack radii wholesale (softer, more brand-forward, less dense) — which WOULD require a MODIFIED "Visual direction" delta. To be confirmed in the mandatory visual-refinement pass (with Visual Companion mockups) before `/opsx:apply`; the spec deltas below assume the recommended resolution.
