import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

// WCAG AA contrast guard for the CloudStash Monochrome palette
// (restyle-cloudstash-monochrome §6.1 / spec scenario "Identity colours meet
// WCAG AA in both themes"). Reads the ACTUAL oklch token values from
// globals.css, converts oklch -> linear sRGB -> WCAG relative luminance, and
// asserts the load-bearing text/UI pairs clear AA in BOTH the light (`:root`)
// and dark (`.dark`) themes — the muted-text-on-surface pairs are the risk.
//
// AA thresholds: 4.5:1 for normal-size body text, 3:1 for large text /
// non-text UI (focus ring). Colours are authored oklch in globals.css; this
// test converts them exactly (Björn Ottosson OKLCH->OKLab->LMS->linear sRGB),
// so it guards the rendered colour, not a hex comment.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const css = readFileSync(join(__dirname, "..", "globals.css"), "utf8");

// --- oklch parsing (reuse the brace-balanced block scan) ---------------------
function extractBlock(source: string, selector: RegExp): string {
  const match = selector.exec(source);
  if (!match) throw new Error(`block not found: ${selector}`);
  const openIdx = source.indexOf("{", match.index);
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(openIdx + 1, i - 1);
}

function tokenOklch(block: string, token: string): { L: number; C: number; H: number } {
  const re = new RegExp(
    `${token}\\s*:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`,
    "i",
  );
  const m = re.exec(block);
  if (!m) {
    // oklch(L 0 0) shorthand for pure neutrals (chroma/hue omitted-as-zero).
    const re0 = new RegExp(`${token}\\s*:\\s*oklch\\(\\s*([\\d.]+)\\s+0\\s+0`, "i");
    const m0 = re0.exec(block);
    if (m0) return { L: Number(m0[1]), C: 0, H: 0 };
    throw new Error(`token ${token} not found (or not oklch) in block`);
  }
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

// --- oklch -> WCAG relative luminance ---------------------------------------
// OKLCH -> OKLab -> LMS' -> LMS -> linear sRGB, then Y = 0.2126 R + 0.7152 G +
// 0.0722 B on the (clamped) linear-light channels — which is exactly the WCAG
// relative luminance (no sRGB gamma round-trip needed for luminance).
function relativeLuminance({ L, C, H }: { L: number; C: number; H: number }): number {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const R = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const G = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const B = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: { L: number; C: number; H: number }, b: { L: number; C: number; H: number }): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const rootBlock = extractBlock(css, /(^|\s):root\s*\{/);
const darkBlock = extractBlock(css, /(^|\s)(?:html\s*)?\.dark\s*\{/);

const THEMES = [
  { name: "light (:root)", block: rootBlock },
  { name: "dark (.dark)", block: darkBlock },
] as const;

// text pairs need 4.5:1; non-text UI (focus ring vs its backgrounds) needs 3:1.
const TEXT_AA = 4.5;
const UI_AA = 3;

describe("CloudStash Monochrome — WCAG AA contrast (both themes)", () => {
  for (const { name, block } of THEMES) {
    const tok = (t: string) => tokenOklch(block, t);

    describe(name, () => {
      it("body text (foreground) clears AA on background AND on card", () => {
        expect(contrast(tok("--foreground"), tok("--background"))).toBeGreaterThanOrEqual(TEXT_AA);
        expect(contrast(tok("--foreground"), tok("--card"))).toBeGreaterThanOrEqual(TEXT_AA);
      });

      it("muted text (muted-foreground) clears AA on background AND on card", () => {
        // The risk pair: muted text on the canvas must not fall below 4.5:1.
        expect(contrast(tok("--muted-foreground"), tok("--background"))).toBeGreaterThanOrEqual(TEXT_AA);
        expect(contrast(tok("--muted-foreground"), tok("--card"))).toBeGreaterThanOrEqual(TEXT_AA);
      });

      it("primary button label (primary-foreground on primary) clears AA", () => {
        expect(contrast(tok("--primary-foreground"), tok("--primary"))).toBeGreaterThanOrEqual(TEXT_AA);
      });

      it("secondary/accent surface labels clear AA", () => {
        expect(contrast(tok("--secondary-foreground"), tok("--secondary"))).toBeGreaterThanOrEqual(TEXT_AA);
        expect(contrast(tok("--accent-foreground"), tok("--accent"))).toBeGreaterThanOrEqual(TEXT_AA);
      });

      it("focus ring clears non-text UI contrast (3:1) on background AND card", () => {
        expect(contrast(tok("--ring"), tok("--background"))).toBeGreaterThanOrEqual(UI_AA);
        expect(contrast(tok("--ring"), tok("--card"))).toBeGreaterThanOrEqual(UI_AA);
      });
    });
  }

  it("sanity: the converter distinguishes a known high-contrast pair", () => {
    // White vs near-black must read ~21:1; guards against a silently-broken
    // luminance transform making everything trivially 'pass'.
    const white = { L: 1, C: 0, H: 0 };
    const black = { L: 0, C: 0, H: 0 };
    expect(contrast(white, black)).toBeGreaterThan(20);
  });
});
