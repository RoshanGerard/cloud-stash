# Tasks — backfill-header-mark-and-search (Pattern A: implementation already shipped)

All implementation tasks shipped on `fix-cloudstash-visual-drift` before this
back-fill (`6e906dc` search, `0ed683a` mark); they are pre-checked. The
remaining open work is the OpenSpec lifecycle for this back-fill.

## 1. Implementation (already shipped)

- [x] 1.1 Header mark → transparent theme-swapped PNG (`0ed683a`): ship
  `cloudstash-mark-{dark,light}.png`, point `cloudstash-logo.tsx` at them,
  remove the orphaned `.svg` marks, keep the theme-swap / a11y / colour-literal
  ban / `CloudStashGlyph` unchanged.
- [x] 1.2 Update `cloudstash-logo.test.tsx` to assert the `.png` srcs and drop
  the obsolete SVG `innerGlow` filter-region guard (asset removed).
- [x] 1.3 Dashboard search field (`6e906dc`): `<input type="search">` in the
  toolbar before Add, client-side filter over the populated grid by
  `displayName` / `providerId` (case-insensitive), `datasources-no-matches`
  state, empty-query pass-through, with tests.
- [x] 1.4 Verify: typecheck clean, changed-file lint clean, full suite green
  (336 files / 3234 passed), and the real header rendered at 28px on both themes.

## 2. Back-fill (this change)

- [x] 2.1 `proposal.md` — as-shipped framing (opens "implementation already
  shipped"), both deltas scoped to `datasources-ui`.
- [x] 2.2 `design.md` — as-shipped contract read from the diff (D1 PNG-not-SVG,
  D2 theme-swap kept, D3 client-side search filter, D4 `1af16bf` superseded).
- [x] 2.3 `specs/datasources-ui/spec.md` — MODIFIED mark scenario (SVG → raster
  PNG) + ADDED search-filter requirement (3 scenarios mirroring the test).
- [x] 2.4 `openspec validate backfill-header-mark-and-search` passes.
- [x] 2.5 `/opsx:sync` — applied the delta to canonical `datasources-ui/spec.md`;
  REPLACED the old "SVG artwork" mark scenario (no duplicate); post-sync check:
  exactly one mark scenario, reading PNG/raster; no leftover SVG mark wording.
- [x] 2.6 `openspec validate datasources-ui --type spec` passes.
- [ ] 2.7 `/opsx:archive` (after advisor checkpoint b).
