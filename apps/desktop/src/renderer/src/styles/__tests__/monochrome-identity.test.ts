import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

// CloudStash Monochrome identity guards (restyle-cloudstash-monochrome §3).
// These read `globals.css` as a string — no browser or rendered DOM needed —
// and assert the three load-bearing properties of the new visual identity:
//   1. No named theme beyond Light/Dark/System ships (Serene Blue retired).
//   2. The primary button is a flat solid fill (no gradient / emboss).
//   3. The accent/ring resolves to a monochrome neutral in BOTH themes.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GLOBALS_CSS_PATH = join(__dirname, "..", "globals.css");
const css = readFileSync(GLOBALS_CSS_PATH, "utf8");

// Return the text inside the first `{ ... }` that follows `selector`,
// brace-balanced so nested at-rules don't confuse the scan.
function extractBlock(source: string, selector: RegExp): string | null {
  const match = selector.exec(source);
  if (!match) return null;
  const openIdx = source.indexOf("{", match.index);
  if (openIdx === -1) return null;
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return depth === 0 ? source.slice(openIdx + 1, i - 1) : null;
}

function tokenValueMap(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.set(m[1]!, m[2]!.trim());
  return out;
}

// Chroma is the 2nd component of `oklch(L C H)` (or 0 for `oklch(L 0 0)`).
function chromaOf(oklchValue: string): number {
  const m = /oklch\(\s*[\d.]+\s+([\d.]+)/i.exec(oklchValue);
  return m ? Number(m[1]) : Number.NaN;
}

const rootBlock = extractBlock(css, /(^|\s):root\s*\{/);
const darkBlock = extractBlock(css, /(^|\s)(?:html\s*)?\.dark\s*\{/);

// The retired crimson brand token, assembled from fragments so THIS guard file
// contains no literal occurrence of it — that keeps the whole-tree grep proof
// (`git grep <token> -- apps` returns nothing) honest: the only thing that
// would ever match is production code that still consumes it.
const BRAND_TOKEN = ["brand", "primary"].join("-"); // the retired crimson token

// Roots for the "no feature .tsx references the retired crimson token" scan
// (datasources-ui scenario "Palette is monochrome with no crimson brand
// token"). Scans every production `.tsx` under features/ and the NON-shadcn
// part of components/ (the shadcn-generated `components/ui/` primitives are
// excluded — they are upstream source, not feature code). __tests__ dirs and
// test files are excluded so historical mentions in tests never self-flag.
const RENDERER_SRC = join(__dirname, "..", "..");
const FEATURES_ROOT = join(RENDERER_SRC, "features");
const COMPONENTS_ROOT = join(RENDERER_SRC, "components");

function* walkFeatureTsx(dir: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory absent — nothing to scan
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "__tests__" ||
        entry.name === "ui" || // shadcn-generated primitives — not feature code
        entry.name === "node_modules" ||
        entry.name === "dist"
      ) {
        continue;
      }
      yield* walkFeatureTsx(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".tsx")) continue;
    if (entry.name.endsWith(".test.tsx")) continue;
    yield full;
  }
}

describe("CloudStash Monochrome identity", () => {
  it("has both a :root and a .dark block", () => {
    expect(rootBlock).not.toBeNull();
    expect(darkBlock).not.toBeNull();
  });

  describe("no legacy named theme beyond Light/Dark/System ships", () => {
    it("globals.css defines no Serene Blue block", () => {
      expect(css).not.toMatch(/serene-blue/i);
    });

    it("globals.css defines no `[data-theme=...]` named-theme selector at all", () => {
      // Light/Dark are the ONLY palettes: light via `:root`, dark via `.dark`.
      // Any `[data-theme=...]` block would be a third named theme.
      expect(css).not.toMatch(/\[data-theme=/);
    });
  });

  describe("primary button is a flat solid fill", () => {
    // Task D.2 scopes the flat treatment to the PRIMARY token specifically —
    // it is a single solid tone (silver on dark / ink on light), not the
    // pack's glossy gradient chip. We deliberately do NOT ban gradients
    // file-wide: design.md Decision 5 keeps gradient/shadow as the depth
    // system, so a future canvas-gradient token must not trip this guard.
    it("--primary is a single solid oklch() color in both themes (no gradient/emboss)", () => {
      for (const [name, block] of [
        [":root", rootBlock],
        [".dark", darkBlock],
      ] as const) {
        const primary = tokenValueMap(block ?? "").get("--primary");
        expect(primary, `${name} defines --primary`).toBeDefined();
        // A single solid color function — one oklch(...) call, no gradient.
        expect(primary).toMatch(/^oklch\([^)]+\)$/i);
        expect(primary).not.toMatch(/gradient/i);
      }
    });
  });

  describe("accent/ring is a monochrome neutral in both themes", () => {
    it("--ring resolves to a low-chroma neutral (silver on dark, graphite on light)", () => {
      const lightRing = tokenValueMap(rootBlock ?? "").get("--ring");
      const darkRing = tokenValueMap(darkBlock ?? "").get("--ring");
      expect(lightRing).toBeDefined();
      expect(darkRing).toBeDefined();
      // Monochrome neutral: chroma well below any chromatic (blue/crimson) hue.
      expect(chromaOf(lightRing!)).toBeLessThan(0.04);
      expect(chromaOf(darkRing!)).toBeLessThan(0.04);
    });

    it("distinguishes the reserved status hue (--destructive stays chromatic)", () => {
      // Sanity: the chroma parser isn't just returning ~0 for everything —
      // the status/danger token IS chromatic, proving the ring is neutral by
      // choice, not by measurement error.
      const darkDestructive = tokenValueMap(darkBlock ?? "").get("--destructive");
      expect(chromaOf(darkDestructive!)).toBeGreaterThan(0.1);
    });
  });
});

// datasources-ui scenario: "Palette is monochrome with no crimson brand token".
// The retired crimson brand token is gone from BOTH theme blocks and from the
// stylesheet entirely, and no feature `.tsx` still depends on it (the mark
// swapped from a token-tinted inline SVG to theme-swapped .svg artwork in
// restyle-cloudstash-monochrome §4.1). `BRAND_TOKEN` is built from fragments
// above so this guard never self-references the very literal it bans.
describe("Palette is monochrome with no crimson brand token", () => {
  const declRe = new RegExp(`--${BRAND_TOKEN}\\s*:`);
  const nameRe = new RegExp(`--${BRAND_TOKEN}`);

  it("globals.css declares no retired crimson brand token in :root or .dark", () => {
    expect(rootBlock).not.toMatch(declRe);
    expect(darkBlock).not.toMatch(declRe);
  });

  it("globals.css does not reference the retired crimson brand token anywhere", () => {
    expect(css).not.toMatch(nameRe);
  });

  it("no feature `.tsx` (features/ or non-shadcn components/) references the retired crimson brand token", () => {
    const offenders: string[] = [];
    for (const root of [FEATURES_ROOT, COMPONENTS_ROOT]) {
      for (const file of walkFeatureTsx(root)) {
        const content = readFileSync(file, "utf8");
        if (content.includes(BRAND_TOKEN)) {
          offenders.push(file.replace(RENDERER_SRC, ".").replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
