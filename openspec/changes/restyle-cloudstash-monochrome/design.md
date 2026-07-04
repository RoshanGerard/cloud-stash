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
2. **Pure-silver monochrome accent; retire crimson.** `--brand-primary` (crimson) is removed. Focus/active/selection use silver (`#E6E9EE` / accent `#A6ABB5`), AA-verified against the graphite surfaces. No blue (the blue on the pack's styleguide boards is not in the shipped theme CSS). Primary button = **flat** inverted silver — a single solid fill (dark `#E6E9EE` / light `#1B222C`) on ink (dark `#0B1016` / light `#F4F6F8`), with NO gradient, inner highlight, or drop shadow; hover shifts the fill only. *(Visual-refinement pass 2026-07-04: the pack's `#EEF1F5→#9AA2AE` **gradient** + inset highlight read as a glossy 3D chip — rejected in favour of a flat slab that fits the precise monochrome direction.)*
3. **Brand mark ships as fixed theme-swapped SVG assets, not a tinted token.** The CloudStash mark is a multi-gradient 3D cloud + silver seam — it is NOT `currentColor`-tintable, so `CloudStashLogo` stops consuming `--brand-primary` and instead renders `mark-dark.svg` on dark / `mark-light.svg` on light (swapped by theme), plus a `glyph.svg` (`stroke=currentColor`) for 16–32px surfaces (favicon/tray). OS icons are generated from the app-tile SVG. Runtime consumers of `--brand-primary` (grep-confirmed 2026-07-04): only `globals.css` (defines it) and `cloudstash-logo.tsx:78` (`<g fill="var(--brand-primary)">`); `cloudstash-logo.test.tsx` asserts the crimson fill and MUST be rewritten for the theme-swapped mark — removal then leaves nothing dangling. Mark hex lives in the `.svg` asset files (NOT inline in `.tsx`) so the colour-literal ban does not trip.
4. **Display typeface = Bricolage Grotesque (OFL), self-hosted via `next/font`.** Used for the wordmark and section headings; Geist Sans remains the UI/body font and Geist Mono the monospace face. Rationale: a distinctive, contemporary grotesque with character that pairs with Geist's neo-grotesque neutrality, avoids the banned Inter/Roboto/Arial and the pack's licensing-placeholder Inter, and is OFL + self-hostable (no runtime fetch). Alternative considered: Space Grotesk (cleaner/techy but more common) — kept as fallback.
5. **Depth is faked with gradient/shadow/glow, no new glass.** The pack's elevation is shadow/gradient, not blur; `backdrop-blur` stays limited to the two already-permitted overlay surfaces (Dialog scrim, DropdownMenu) per the existing Visual-direction requirement.
6. **Serene Blue retired normatively — full removal surface.** Retiring Serene Blue is a *multi-file* removal (confirmed by grep 2026-07-04, not just the CSS block): the `[data-theme="serene-blue"]` block + comments in `globals.css`; the `{ value: "serene-blue", label: "Serene Blue", icon: "droplets" }` option and `case "serene-blue"` in `theme-switcher.tsx`; the `"serene-blue"` arm of the `ThemePreference` union + its parse/apply (`data-theme`-setting) logic in `theme-store.ts`; the `"serene-blue"` branch in the inline `THEME_BOOTSTRAP_SCRIPT` in `theme-script.ts`; the `pref === "serene-blue" ? "light"` mapping in `sonner.tsx`; and the `droplets` switcher-indicator use in `icon.tsx` (drop if now unused). The MODIFIED UI-foundation requirement states no theme beyond Light/Dark/System ships — turning the (previously code-only) retirement into a spec'd contract; **the removal is that requirement's implementation — no extra delta.** The `datasources-ui` `## Purpose` prose that mentions "Serene Blue" is fixed by a tracked direct edit (the delta lifecycle cannot reach Purpose — same mechanism as change 1's Decision 12). *(tasks §3.3 "drop any Serene Blue option" is expanded by this decision to the full surface above.)*

## Risks / Trade-offs

- **[Font dependency]** → `Bricolage Grotesque` added via `@fontsource`/`next/font`, self-hosted, OFL, no runtime fetch — justified here per the no-unjustified-dep rule. If icon generation needs `sharp` as an explicit devDependency, justify at apply.
- **[AA contrast on the graphite ramp]** → silver-on-graphite and muted-text (`#8A909A` / `#5C616C`) must be AA-checked in both themes; the muted-on-surface pairs are the risk. Verified during apply with a contrast test.
- **[Colour-literal ban]** → all new palette values live in `globals.css` only; feature code stays token-driven. The existing literal-ban test guards this.
- **[Post-rename dependency]** → operates on `CloudStashLogo`, `cloudstash.*` theme key, and `@cloudstash/*` — assumes `rebrand-to-cloudstash` merged; pre-apply staleness check confirms.

## Visual direction

Locked from the 2026-07-04 pack brainstorm + delegated decisions, then confirmed/refined in the mandatory visual-refinement pass (2026-07-04, interactive mockup — theme + radii toggle on the real dashboard):
- **Palette**: CloudStash Monochrome Dark (canonical) + a new monochrome Light. Canvas `#080F14`; surface ramp `#12171E`/`#181E27`/`#202632`/`#2A323F`; borders `#343D4D`; text `#F2F4F7`/`#D1D5DB`/`#B8BDC6`/`#8A909A`; muted `#5C616C`; accent silver `#A6ABB5`/`#E6E9EE`; status `#4ADE80` / `#F59E0B` / `#F87171` / `#60A5FA` only. Monochrome Light derives to a cool-paper canvas with white cards, ink text, and a graphite (not silver) accent — silver fails AA on a light ground, so the light accent darkens toward `#343D4D`/`#202632`.
- **Accent**: pure monochrome silver on dark, graphite on light; no crimson, no blue.
- **Primary button**: **flat** inverted silver — a single solid fill (dark `#E6E9EE` / light `#1B222C`) on ink (dark `#0B1016` / light `#F4F6F8`), no gradient / inner highlight / drop shadow; hover shifts the fill only. *(Refined this pass — the pack's `#EEF1F5→#9AA2AE` gradient read as glossy 3D.)*
- **Radii / density — RESOLVED (this pass):** keep the dense-quiet radii (routine data surfaces — cards, list rows, inputs, badges — at ≤ `rounded-md` 6px, no pill/`rounded-full`); reserve the pack's larger radii only for the mark/app-tile and elevated overlays (Dialog). CloudStash is a dense data tool; tight corners hold information density. **The existing `datasources-ui` "Visual direction" requirement is UNCHANGED — no spec delta.** (The alternative — adopting the pack radii 8–24px wholesale — was declined; it would have required a MODIFIED "Visual direction" delta.)
- **Type**: Bricolage Grotesque (display/wordmark) + Geist Sans (UI) + Geist Mono (mono).
- **Mark**: theme-swapped SVG (dark/light) + currentColor glyph; not token-tinted.
- **Depth/motion**: shadow/gradient/glow depth, no new blur; keep the three existing animations (pack ships none).

## Open Questions

- ~~**Radii / density reconciliation (the one open visual fork).**~~ **RESOLVED** in the visual-refinement pass (2026-07-04): keep the dense-quiet radii (routine data surfaces ≤ `rounded-md` 6px, no pill), reserve the pack's larger radii only for the mark/app-tile and elevated overlays (Dialog). The `datasources-ui` "Visual direction" requirement is UNCHANGED — no MODIFIED delta. See `## Visual direction` above for the recorded resolution and the flat-primary-button refinement. No open questions remain.
