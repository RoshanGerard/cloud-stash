## MODIFIED Requirements

### Requirement: UI foundation layer — shadcn/ui primitives with light and dark themes

The renderer SHALL use shadcn/ui as its primitive component source, initialized via `npx shadcn@latest init` and generated into `apps/desktop/src/renderer/src/components/ui/` as in-repo source (not a runtime dependency). The generated primitive set SHALL include at minimum `button`, `card`, `badge`, `dialog`, `dropdown-menu`, `progress`, `tooltip`, `input`, `label`, `skeleton`, and `sonner`.

The renderer SHALL ship BOTH a CloudStash Monochrome **light** theme and a CloudStash Monochrome **dark** theme as CSS variables; the dark theme is the canonical CloudStash identity. The dark theme SHALL be activated by the presence of the `.dark` class on the `<html>` element; its absence SHALL result in the light theme. No named theme beyond Light / Dark / System (in particular no legacy "Serene Blue") SHALL ship. Both theme variable sets SHALL be defined in the renderer's global stylesheet and SHALL cover every token shadcn generates (background, foreground, muted, primary, secondary, accent, destructive, border, input, ring, card, popover, and their `-foreground` variants).

The renderer SHALL provide a user-facing theme switcher with exactly three options: Light, Dark, and System. The selection SHALL persist across app restarts via `localStorage` under a stable key. Before the React tree mounts, an inline bootstrap script SHALL resolve the effective theme (explicit `localStorage` preference if present, otherwise `prefers-color-scheme`) and set or clear `.dark` on `<html>` so the first paint matches the final theme (no flash of wrong theme).

Primitives SHALL meet a defined accessibility baseline: every interactive primitive has a visible focus ring whose contrast against its background meets WCAG 2.2 non-text contrast (3:1); keyboard activation matches native semantics; composite primitives (`Dialog`, `DropdownMenu`, `Tooltip`) delegate to the corresponding `@radix-ui/react-*` package for focus trapping and ARIA. Feature code SHALL consume colour and spacing through Tailwind utilities that resolve against the token CSS variables (e.g. `bg-background`, `text-foreground`), NOT through hex / rgb / named-colour literals.

#### Scenario: Both themes ship and are activated via `.dark` on `<html>`

- **WHEN** the renderer's global stylesheet is loaded
- **THEN** a `:root` selector defines CSS variables for the light theme and an `html.dark` (or `.dark`) selector defines CSS variables for the dark theme; removing `.dark` from `<html>` SHALL switch the rendered UI to the light theme without any JavaScript rerun, and adding it SHALL switch to the dark theme

#### Scenario: Theme switcher exposes Light / Dark / System

- **WHEN** the user opens the theme switcher in the dashboard toolbar
- **THEN** the menu presents exactly three options labelled "Light", "Dark", and "System"; selecting one persists the choice to `localStorage` under the app's theme key; selecting "System" removes the explicit preference and falls back to `prefers-color-scheme`; the selected theme is reflected in the rendered UI within one frame

#### Scenario: No legacy theme beyond Light/Dark/System ships

- **WHEN** a Vitest test scans the renderer's global stylesheet and the theme switcher
- **THEN** no `[data-theme="serene-blue"]` selector (or any named-theme block other than the light/dark variable sets) is present, and the switcher exposes no option beyond Light / Dark / System

#### Scenario: No flash of wrong theme on cold start

- **WHEN** the app launches with an explicit dark preference stored in `localStorage`
- **THEN** the first painted frame SHALL already be in the dark theme; the `.dark` class SHALL be present on `<html>` before React mounts; a Playwright screenshot taken at first paint SHALL show dark-theme colours, not a flash of the light theme

#### Scenario: Feature code uses token-backed utilities, not colour literals

- **WHEN** a Vitest test scans every `.tsx` file under `apps/desktop/src/renderer/src/features/` and the non-shadcn-generated portion of `components/`
- **THEN** no hex colour literal, no `rgb(` / `hsl(` literal outside the global stylesheet, and no hard-coded `font-size` px literal is present; colour and typography are consumed through Tailwind utility classes (`bg-background`, `text-foreground`, etc.) or the exported token module

#### Scenario: Focus is visible on keyboard navigation

- **WHEN** the user presses Tab through the dashboard and add-dialog
- **THEN** every interactive element displays a focus ring whose contrast against its background meets WCAG 2.2 non-text contrast (3:1), using `:focus-visible` styling (not `:focus`), in both the light and dark themes

#### Scenario: Dialog, DropdownMenu, and Tooltip delegate to Radix

- **WHEN** the `Dialog`, `DropdownMenu`, or `Tooltip` primitive is imported
- **THEN** its implementation (from the shadcn-generated file) delegates to the corresponding `@radix-ui/react-*` package for open/close state, focus trapping, and keyboard interaction; hand-rolled focus management is NOT present

## ADDED Requirements

### Requirement: CloudStash brand identity — monochrome palette, silver accent, mark, and display type

The renderer SHALL present the **CloudStash Monochrome** visual identity. The palette SHALL be monochrome graphite with silver accents and status colours only: a dark canvas and layered graphite surfaces, a silver text ramp, a silver accent for focus/active/selection, and the four status hues (success/warning/danger/info) reserved for status only. There SHALL be no crimson brand colour and no chromatic (blue/coloured) accent; the previous `--brand-primary` crimson token SHALL be removed and no feature code SHALL depend on it. The primary button SHALL use an inverted-silver treatment (light silver fill on ink foreground) rather than a coloured fill. All identity colours SHALL meet WCAG AA text/UI contrast in both the light and dark themes.

The CloudStash **mark** SHALL be shipped as fixed SVG artwork swapped by theme (a dark-optimised mark on the dark theme and a light-optimised mark on the light theme) rather than tinted through a single colour token, because the mark is a multi-gradient asset that is not `currentColor`-tintable. A `currentColor` **glyph** variant SHALL be provided for small surfaces (16–32px: favicon, tray) so those inherit the theme foreground. The header wordmark SHALL render the CloudStash name (no Forti5 identity remains).

Typography SHALL layer a distinctive display typeface for the wordmark and section headings on top of the existing UI type: the display face (an OFL, self-hosted face loaded via `next/font`, e.g. Bricolage Grotesque) SHALL be used for the wordmark and headings, while Geist Sans remains the UI/body font and Geist Mono the monospace face. No display/UI font SHALL be fetched at runtime (all faces ship with the app).

#### Scenario: Palette is monochrome with no crimson brand token

- **WHEN** a Vitest test scans the renderer's global stylesheet
- **THEN** the light and dark theme variable sets define a monochrome graphite/silver palette with status hues reserved for status tokens; no `--brand-primary` (crimson) token is defined or referenced by any feature `.tsx`; the accent/ring tokens resolve to silver, not blue or crimson

#### Scenario: Mark is theme-swapped SVG artwork with a currentColor glyph

- **WHEN** the app header renders on the dark theme and on the light theme
- **THEN** `CloudStashLogo` renders the dark-optimised mark on dark and the light-optimised mark on light (theme-swapped SVG assets, not a single token-tinted SVG), the wordmark reads "CloudStash", and a `currentColor` glyph variant exists for 16–32px surfaces (favicon/tray)

#### Scenario: Display face applies to the wordmark/headings, Geist to UI, no runtime fetch

- **WHEN** the renderer builds and renders the header wordmark and a section heading
- **THEN** the display face is imported through `next/font` (self-hosted, OFL) and applied to the wordmark and headings, Geist Sans remains the UI/body font and Geist Mono the monospace face, and no `<link rel="stylesheet" href="https://fonts.googleapis.com/...">` or other runtime font fetch appears in the rendered HTML

#### Scenario: Identity colours meet WCAG AA in both themes

- **WHEN** a contrast test evaluates the primary button, accent/focus ring, body text, and muted text against their backgrounds in both the light and dark themes
- **THEN** each pair meets WCAG AA (4.5:1 for body text, 3:1 for large text / non-text UI), including the muted-text-on-surface pairs
