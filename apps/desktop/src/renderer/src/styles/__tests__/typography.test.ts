import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

// Typography wiring per design.md Decision 9: the renderer uses Geist Sans +
// Geist Mono via `next/font` (zero-runtime fetch — fonts are bundled at build
// time, not requested from fonts.googleapis.com on boot), and the fonts are
// applied to <html> as CSS variables `--font-geist-sans` + `--font-geist-mono`.
// Tailwind v4's `@theme inline` block bridges those variables to
// `font-sans` / `font-mono` utilities.
//
// This test reads the relevant source files as text — deliberately NOT
// rendering <RootLayout> via React Testing Library. Reasons:
//   1. `next/font` is a compile-time loader. Importing `geist/font/sans`
//      inside raw Vitest throws "Next.js font loaders can only be used
//      in the Next.js build."
//   2. `GeistSans.variable` at runtime is a generated class name (like
//      `__variable_abc123`) that maps to the CSS variable via a stylesheet
//      next/font injects at build time. It is NOT the literal string
//      `--font-geist-sans`, so a `className` string search wouldn't match.
//   3. The existing `theme.test.ts` already uses this file-as-text pattern
//      for CSS and layout assertions.
//
// The substantive correctness property — "fonts load via next/font and are
// exposed as CSS variables" — is encoded by:
//   (a) layout.tsx imports `GeistSans` from `geist/font/sans` and
//       `GeistMono` from `geist/font/mono`;
//   (b) both `.variable` className tokens appear in the <html> element's
//       className expression;
//   (c) no `fonts.googleapis.com` (or similar runtime-fetch domain) URL
//       appears in layout.tsx or globals.css;
//   (d) Tailwind v4's `@theme inline` block wires
//       `--font-sans: var(--font-geist-sans), ...` and
//       `--font-mono: var(--font-geist-mono), ...`.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LAYOUT_PATH = join(
  __dirname,
  "..",
  "..",
  "app",
  "layout.tsx",
);
const GLOBALS_CSS_PATH = join(__dirname, "..", "globals.css");

const RUNTIME_FONT_FETCH_DOMAINS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "use.typekit.net",
];

describe("typography — Geist font wiring", () => {
  it("layout.tsx imports GeistSans from geist/font/sans", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    expect(text).toMatch(
      /import\s*\{[^}]*\bGeistSans\b[^}]*\}\s*from\s*["']geist\/font\/sans["']/,
    );
  });

  it("layout.tsx imports GeistMono from geist/font/mono", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    expect(text).toMatch(
      /import\s*\{[^}]*\bGeistMono\b[^}]*\}\s*from\s*["']geist\/font\/mono["']/,
    );
  });

  it("layout.tsx applies both font variables to the <html> className", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    // Grab the <html ...> JSX opening tag. Requires whitespace after `<html`
    // so the text "<html>" appearing in a comment (no attributes) isn't the
    // match. Tolerates multi-line JSX attributes via `[\s\S]`.
    const htmlTagMatch = text.match(/<html\s[\s\S]*?>/);
    expect(
      htmlTagMatch,
      "expected a <html> element in layout.tsx",
    ).not.toBeNull();
    const htmlTag = htmlTagMatch![0];
    expect(htmlTag).toMatch(/\bGeistSans\.variable\b/);
    expect(htmlTag).toMatch(/\bGeistMono\.variable\b/);
  });

  it("layout.tsx does NOT fetch fonts at runtime from common font CDNs", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    for (const domain of RUNTIME_FONT_FETCH_DOMAINS) {
      expect(
        text.includes(domain),
        `layout.tsx must not reference ${domain} (fonts load via next/font at build time)`,
      ).toBe(false);
    }
  });

  it("globals.css does NOT fetch fonts at runtime from common font CDNs", () => {
    const text = readFileSync(GLOBALS_CSS_PATH, "utf8");
    for (const domain of RUNTIME_FONT_FETCH_DOMAINS) {
      expect(
        text.includes(domain),
        `globals.css must not reference ${domain} (fonts load via next/font at build time)`,
      ).toBe(false);
    }
  });

  it("globals.css maps --font-sans to var(--font-geist-sans) via @theme", () => {
    const text = readFileSync(GLOBALS_CSS_PATH, "utf8");
    // Looks inside the @theme block for `--font-sans: var(--font-geist-sans), ...`.
    expect(text).toMatch(/--font-sans\s*:\s*var\(--font-geist-sans\)/);
  });

  it("globals.css maps --font-mono to var(--font-geist-mono) via @theme", () => {
    const text = readFileSync(GLOBALS_CSS_PATH, "utf8");
    expect(text).toMatch(/--font-mono\s*:\s*var\(--font-geist-mono\)/);
  });
});

// Display-face wiring per design.md Decision 4 (restyle-cloudstash-monochrome
// §4.3): a distinctive display typeface — Bricolage Grotesque (OFL) — is layered
// on top of the Geist UI/mono type for the wordmark and section headings. It is
// self-hosted via `next/font/local` from a woff2 vendored into the repo (zero
// runtime fetch), exposed on <html> as the CSS variable `--font-display-face`,
// and bridged in globals.css's `@theme inline` block to the Tailwind
// `font-display` utility (`--font-display: var(--font-display-face), ...`).
// Same file-as-text approach as the Geist block above: `next/font/local` is a
// compile-time loader that throws outside the Next.js build, and the resolved
// `.variable` token is a generated class name, not the literal CSS var name.

const DASHBOARD_PATH = join(
  __dirname,
  "..",
  "..",
  "features",
  "datasources",
  "dashboard.tsx",
);
const DIALOG_PATH = join(
  __dirname,
  "..",
  "..",
  "components",
  "ui",
  "dialog.tsx",
);

describe("typography — Bricolage Grotesque display face wiring", () => {
  it("layout.tsx imports localFont from next/font/local", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    expect(text).toMatch(
      /import\s+localFont\s+from\s+["']next\/font\/local["']/,
    );
  });

  it("layout.tsx loads the display face via localFont and exposes --font-display-face", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    // The localFont() call self-hosts the vendored woff2 and names its CSS
    // variable --font-display-face (the theme bridge maps that to --font-display).
    expect(text).toMatch(/localFont\s*\(/);
    expect(text).toMatch(/variable\s*:\s*["']--font-display-face["']/);
  });

  it("layout.tsx applies the display font variable to the <html> className alongside Geist", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    const htmlTagMatch = text.match(/<html\s[\s\S]*?>/);
    expect(
      htmlTagMatch,
      "expected a <html> element in layout.tsx",
    ).not.toBeNull();
    const htmlTag = htmlTagMatch![0];
    // Geist stays the UI/mono face; the display face is layered on top.
    expect(htmlTag).toMatch(/\bGeistSans\.variable\b/);
    expect(htmlTag).toMatch(/\bGeistMono\.variable\b/);
    expect(htmlTag).toMatch(/\bbricolage\.variable\b/);
  });

  it("globals.css bridges --font-display to var(--font-display-face) via @theme", () => {
    const text = readFileSync(GLOBALS_CSS_PATH, "utf8");
    expect(text).toMatch(/--font-display\s*:\s*var\(--font-display-face\)/);
  });

  it("does NOT fetch the display face at runtime from common font CDNs", () => {
    // next/font injects @font-face into the built CSS, so a regression to a
    // hosted face would show up as one of these domains in either source file.
    for (const path of [LAYOUT_PATH, GLOBALS_CSS_PATH]) {
      const text = readFileSync(path, "utf8");
      for (const domain of RUNTIME_FONT_FETCH_DOMAINS) {
        expect(
          text.includes(domain),
          `${path} must not reference ${domain} (display face self-hosted via next/font/local)`,
        ).toBe(false);
      }
    }
  });

  it("does NOT emit an external font <link rel=stylesheet> in layout.tsx", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    expect(text).not.toMatch(
      /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\/[^"']*font/i,
    );
  });

  it("applies the font-display utility to the dashboard page heading", () => {
    // Supplementary to the jsdom render assertions in app-header.test.tsx: the
    // <h1> page title carries the display face.
    const text = readFileSync(DASHBOARD_PATH, "utf8");
    const h1Match = text.match(/<h1[^>]*>/);
    expect(h1Match, "expected an <h1> in dashboard.tsx").not.toBeNull();
    expect(h1Match![0]).toMatch(/\bfont-display\b/);
  });

  it("applies the font-display utility to the DialogTitle primitive", () => {
    // All dialog titles (Settings, etc.) are section headings and inherit the
    // display face from the one shared primitive.
    const text = readFileSync(DIALOG_PATH, "utf8");
    // The DialogTitle renders a `data-slot="dialog-title"` element; assert the
    // display face lands on that element's className.
    const titleEl = text.match(/data-slot="dialog-title"[\s\S]*?\/>/);
    expect(titleEl, "expected a dialog-title element in dialog.tsx").not.toBeNull();
    expect(titleEl![0]).toMatch(/\bfont-display\b/);
  });
});
