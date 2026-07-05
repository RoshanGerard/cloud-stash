# Design: header mark (SVG → transparent PNG) + dashboard search filter — as shipped

## Context

Back-fill of two contract changes already shipped on `fix-cloudstash-visual-drift`
(`6e906dc` search, `0ed683a` mark). This design records the **as-shipped**
contract read from the actual diff, not a forward plan.

**Header mark (before).** `CloudStashLogo` rendered two theme-swapped **SVG**
files (`cloudstash-mark-dark.svg` / `-light.svg`) — multi-gradient 3D cloud
artwork with a folded silver seam. It read "muddy" and, on the dark variant,
truncated at small size (an `innerGlow` `filterUnits="userSpaceOnUse"` region
clipped the left of the cloud; fixed in `1af16bf`, now moot — see below).

**Header mark (after, shipped).** `CloudStashLogo` renders two theme-swapped
**transparent PNG** files (`cloudstash-mark-dark.png` = silver cloud tuned for
the dark theme; `cloudstash-mark-light.png` = graphite cloud tuned for the light
theme), sourced from the user's refined two-cloud artwork (`cloudstash_icon.png`):
the mark's real pixels, brightened for 28px legibility, tile removed to
transparent, and tone-inverted for the light variant. The theme-swap mechanism
(`hidden dark:block` / `block dark:hidden`), the sole `role="img"`
`aria-label="CloudStash"` on a never-`display:none` wrapper, both `<img>`
decorative (`alt="" aria-hidden`), the colour-literal ban, and `CloudStashGlyph`
(currentColor, 16–32px) are all UNCHANGED.

**Dashboard search (shipped).** The dashboard toolbar (`dashboard.tsx`) grew a
search `<input type="search">` (aria-label "Search datasources", testid
`datasources-search`) placed before the Add-datasource button. It drives a
client-side filter over the loaded (populated) list: an entry is visible when
its `displayName` OR `providerId` contains the query, case-insensitively. An
empty query shows everything (no filtering cost). When a non-empty query matches
nothing, the grid is replaced by a `datasources-no-matches` state.

## Goals / Non-Goals

**Goals:**
- Bring the `datasources-ui` spec back in sync with shipped reality: the mark is
  PNG (not SVG); the dashboard has a search filter.
- Capture the search contract precisely enough that future dashboard work can
  rely on it (match field, case-insensitivity, empty-query and no-match states).

**Non-Goals:**
- No code changes (impl already shipped).
- The flat-canvas and title/subtitle refinements from the same branch — Outcome 1,
  no observable contract change, intentionally not spec'd.
- Server-side / backend filtering — the filter is client-side over the already
  loaded list only.
- Retiring `CloudStashGlyph` or the app-tile favicon — both unchanged.

## Decisions

- **D1 — PNG raster, not SVG, for the mark.** The refined artwork is
  photographic-style tonal 3D (a filled cloud behind a white-outlined cloud with
  a folded seam), not a single-tone tintable path. It ships as transparent PNG,
  keeping the same theme-swap two-`<img>` structure. Scenario reworded SVG →
  raster (PNG); everything else in the scenario holds.
- **D2 — Theme-swap kept (silver/graphite), not a self-contained tile.** A
  transparent mark on the header must adapt to the background: silver reads on
  dark, graphite (a tonal inversion) reads on light. This reuses the existing
  CSS-only `.dark`-variant swap, so no JS theme read and no FOUC.
- **D3 — Search is a client-side filter over the populated list.** Matches
  `displayName` OR `providerId`, case-insensitive, trimmed. Empty query → full
  list. Non-empty + zero matches → dedicated `datasources-no-matches` panel (not
  a blank grid). Modelled as a NEW requirement (discoverable) rather than a
  scenario bolted onto the state-machine requirement.
- **D4 — `1af16bf` (SVG filter-region fix) is superseded, not separately
  back-filled.** It restored the now-deleted SVG mark; `0ed683a` removed that
  asset. Its regression test was removed with the asset (coverage of deleted
  code, not a live regression). This MODIFIED scenario is the single source of
  truth for the mark going forward.

## Risks / Trade-offs

- **PNG is fixed-resolution.** The 256px marks render at the sole consumer
  (`app-header`, `size={28}`) at ~9× headroom — ample. If a much larger header
  mark surface ever appears, the PNG would need a higher-res export. Acceptable:
  no such surface exists (the large app-icon/splash uses separate assets).
- **Sync must not orphan the old scenario.** Because the scenario title changes
  (SVG → raster), the sync step must REPLACE the existing mark scenario, not
  append a second one. Post-sync check: `datasources-ui/spec.md` contains exactly
  one mark scenario and it reads PNG/raster.
- **Light-theme mark is a tonal inversion** of the silver artwork — validated in
  a real browser at 28px (reads cleanly; the fold inverts to a dark band, not a
  distracting light slash). If ever regenerated, re-verify the light variant.
