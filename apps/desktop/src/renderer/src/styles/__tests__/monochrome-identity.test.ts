import { readFileSync } from "node:fs";
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
