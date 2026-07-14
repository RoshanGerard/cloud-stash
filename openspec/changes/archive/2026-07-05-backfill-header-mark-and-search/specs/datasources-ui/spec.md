# datasources-ui — delta (backfill-header-mark-and-search)

## MODIFIED Requirements

### Requirement: CloudStash brand identity — monochrome palette, flat monochrome accent, mark, and display type

The CloudStash **mark** SHALL be shipped as fixed transparent PNG artwork swapped by theme (a dark-optimised silver mark on the dark theme and a light-optimised graphite mark on the light theme) rather than tinted through a single colour token, because the mark is a tonal raster asset (the two-cloud mark) that is not `currentColor`-tintable. A `currentColor` **glyph** variant SHALL be provided for small surfaces (16–32px: favicon, tray) so those inherit the theme foreground. The header wordmark SHALL render the CloudStash name (no Forti5 identity remains).

_(Only the mark paragraph and the mark scenario change; the palette and typography paragraphs and the other scenarios of this requirement are unchanged. At sync, REPLACE the former "Mark is theme-swapped SVG artwork with a currentColor glyph" scenario — do not append a duplicate.)_

#### Scenario: Mark is theme-swapped raster (PNG) artwork with a currentColor glyph

- **WHEN** the app header renders on the dark theme and on the light theme
- **THEN** `CloudStashLogo` renders the dark-optimised mark on dark and the light-optimised mark on light (theme-swapped transparent **PNG** assets — a silver cloud on the dark theme, a graphite cloud on the light theme — NOT a single token-tinted image), the two `<img>` marks are decorative (`alt=""`, `aria-hidden`) with the sole "CloudStash" accessible name on the wrapper, the wordmark reads "CloudStash", and a `currentColor` glyph variant exists for 16–32px surfaces (favicon/tray)

## ADDED Requirements

### Requirement: Dashboard toolbar filters the datasource grid via a search field

The datasources dashboard toolbar SHALL provide a search field, placed before the Add-datasource action, that filters the populated datasource grid client-side. A datasource is visible when the trimmed query matches its display name OR its provider id, compared case-insensitively. An empty query shows every datasource (no filtering). When a non-empty query matches no datasource, the grid is replaced by a distinct no-matches state rather than a blank grid.

#### Scenario: Search filters the populated grid by name or provider

- **WHEN** the dashboard is in the populated state and the user types a query that matches a subset of datasources by display name or provider id (e.g. "onedrive")
- **THEN** only the matching datasource cards remain mounted and the non-matching cards are removed

#### Scenario: A non-matching query shows a no-matches state, not a blank grid

- **WHEN** the user types a non-empty query that matches no datasource
- **THEN** no datasource cards are mounted and a distinct no-matches indicator (`data-testid="datasources-no-matches"`) is shown

#### Scenario: Clearing the query restores the full list

- **WHEN** the user clears the search field back to an empty query
- **THEN** every datasource card in the loaded list is shown again
