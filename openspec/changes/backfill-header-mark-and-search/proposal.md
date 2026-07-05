# Proposal: Back-fill two datasources-ui contract changes shipped on the visual-drift branch — the header mark (SVG → transparent PNG) and a dashboard search filter

**Implementation already shipped** on branch `fix-cloudstash-visual-drift`:
the search filter in commit `6e906dc`, the header-mark swap in commit `0ed683a`.
This is a Pattern A back-fill — it documents the as-shipped contract; no code
changes here.

## Why

The `fix-cloudstash-visual-drift` branch carried reactive visual fixes. Two of
them changed behaviour the `datasources-ui` spec already documents, so the spec
now drifts from reality:

1. **Header mark format.** The scenario "Mark is theme-swapped **SVG** artwork
   with a currentColor glyph" pins the mark as SVG. The mark is now shipped as
   **transparent PNG** raster artwork (the CloudStash two-cloud mark), still
   theme-swapped, because the previous multi-gradient SVG cloud read "muddy" and
   truncated at small size. The spec's SVG wording no longer matches the code.

2. **Dashboard search.** The dashboard grew a real search field in the toolbar
   that filters the populated grid by datasource name / provider, with a
   "no matches" state. This is new user-facing behaviour with no existing
   scenario — a caller (and any future dashboard work) has nothing to rely on.

Both are `datasources-ui`-only, so they back-fill as one bundled change. (The
same branch's flat-canvas and title/subtitle refinements were Outcome 1 — no
observable contract change — and are intentionally not spec'd here.)

## What Changes

- **MODIFIED** `datasources-ui` scenario "Mark is theme-swapped SVG artwork with
  a currentColor glyph" → "Mark is theme-swapped **raster (PNG)** artwork with a
  currentColor glyph": the header renders two transparent PNG marks swapped by
  theme (a silver cloud on dark, a graphite cloud on light), NOT a single
  token-tinted image; the `currentColor` glyph variant for 16–32px surfaces is
  unchanged.
- **ADDED** `datasources-ui` requirement: the dashboard toolbar filters the
  datasource grid via a search field (matches display name / provider id
  case-insensitively; a "no matches" state; an empty query shows everything).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `datasources-ui`: the CloudStash brand-identity mark scenario changes the
  shipped mark format from SVG to transparent PNG (still theme-swapped); and a
  new requirement documents the dashboard toolbar's search filter over the
  populated grid.

## Impact

- **Code (already shipped, no changes here):**
  - `6e906dc` — `apps/desktop/src/renderer/src/features/datasources/dashboard.tsx`
    (search field in the toolbar + client-side filter + no-matches state) + its
    test.
  - `0ed683a` — `apps/desktop/src/renderer/public/brand/cloudstash-mark-{dark,light}.png`
    (new), the matching `.svg` marks removed, `cloudstash-logo.tsx` (src `.svg`
    → `.png`), and `cloudstash-logo.test.tsx` (assert `.png`; drop the obsolete
    SVG filter-region guard).
- **Spec:** one MODIFIED scenario + one ADDED requirement in `datasources-ui`.
- **No contract/IPC/schema/dependency changes.** The theme-swap mechanism,
  the sole `role="img"` "CloudStash" accessible name, the colour-literal ban,
  and the `CloudStashGlyph` currentColor variant are all unchanged.

## Provenance

- Branch `fix-cloudstash-visual-drift` (off `master`): iterative dashboard
  visual refinement. The header mark went through several rejected candidates
  before the user supplied refined artwork (`Downloads/cloudstash_icon.png` →
  the two-cloud mark); the shipped mark is that artwork's real pixels, brightened
  for 28px legibility, tile removed to transparent, and theme-swapped (silver on
  dark / graphite on light). Verified in a real browser at 28px on both themes.
- Verified from the diff, not guessed: mark srcs are `.png`
  (`cloudstash-logo.tsx`); search filters `displayName` / `providerId`
  case-insensitively with a `datasources-no-matches` state (`dashboard.tsx`,
  `dashboard.test.tsx`).
