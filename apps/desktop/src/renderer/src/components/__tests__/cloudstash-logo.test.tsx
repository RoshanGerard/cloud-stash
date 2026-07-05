/** @vitest-environment jsdom */
//
// restyle-cloudstash-monochrome §4.1 — the brand mark is now the CloudStash
// Monochrome identity. The old inline-polygon Forti5 mark (6 crimson polygons
// tinted through the retired crimson brand token) is gone.
//
// New contract (design.md Decision 3 + datasources-ui scenario "Mark is
// theme-swapped SVG artwork with a currentColor glyph"):
//
//   - CloudStashLogo renders the mark as TWO theme-swapped <img> elements: a
//     dark-optimised mark shown on the dark theme (`hidden dark:block`) and a
//     light-optimised mark shown on the light theme (`block dark:hidden`),
//     toggled purely by CSS via the `.dark`-class Tailwind variant — no JS
//     theme read. The marks are multi-gradient artwork (NOT currentColor-
//     tintable), so they live as .svg asset files served from public/brand/.
//   - The accessible "CloudStash" name lives on a wrapper element that is
//     never `display:none`, so the theme swap can never drop it (a name
//     attached to one <img> would vanish in the theme where that img is
//     `display:none` — including the canonical dark theme). Both mark images
//     are therefore decorative (`alt="" aria-hidden`); the wrapper carries
//     `role="img"` + `aria-label="CloudStash"`. Exactly one accessible name.
//   - CloudStashGlyph is the 16–32px surface variant (favicon/tray): an inline
//     <svg> whose paths stroke with `currentColor` so it inherits the theme
//     foreground.
//   - No hex/rgb/hsl/oklch colour literal appears in the .tsx source (the mark
//     hex lives only in the .svg asset files; the glyph uses currentColor).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CloudStashGlyph, CloudStashLogo } from "../cloudstash-logo";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOGO_SRC_PATH = join(__dirname, "..", "cloudstash-logo.tsx");
// The served dark-mark asset (what ships and renders in the header). Path:
// __tests__ → components → src → renderer → public/brand/…
const MARK_DARK_ASSET_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "public",
  "brand",
  "cloudstash-mark-dark.svg",
);

afterEach(() => {
  cleanup();
});

describe("CloudStashLogo — theme-swapped mark", () => {
  it("renders the dark-optimised mark, shown on dark via `hidden dark:block`", () => {
    const { container } = render(<CloudStashLogo />);
    const dark = container.querySelector<HTMLImageElement>(
      'img[src="/brand/cloudstash-mark-dark.svg"]',
    );
    expect(dark).not.toBeNull();
    // Hidden on light, shown on dark — the CSS-only theme swap.
    expect(dark!.className).toContain("hidden");
    expect(dark!.className).toContain("dark:block");
  });

  it("renders the light-optimised mark, shown on light via `block dark:hidden`", () => {
    const { container } = render(<CloudStashLogo />);
    const light = container.querySelector<HTMLImageElement>(
      'img[src="/brand/cloudstash-mark-light.svg"]',
    );
    expect(light).not.toBeNull();
    expect(light!.className).toContain("block");
    expect(light!.className).toContain("dark:hidden");
  });

  it("renders exactly the two theme-swap mark images", () => {
    const { container } = render(<CloudStashLogo />);
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs).toHaveLength(2);
    const srcs = imgs.map((i) => i.getAttribute("src")).sort();
    expect(srcs).toEqual([
      "/brand/cloudstash-mark-dark.svg",
      "/brand/cloudstash-mark-light.svg",
    ]);
  });

  it("exposes exactly one 'CloudStash' accessible name (no duplicate)", () => {
    const { getAllByRole } = render(<CloudStashLogo />);
    const named = getAllByRole("img", { name: /CloudStash/i });
    expect(named).toHaveLength(1);
  });

  it("marks BOTH swap images decorative (alt='' aria-hidden) so the swap never drops the name", () => {
    const { container } = render(<CloudStashLogo />);
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs).toHaveLength(2);
    for (const img of imgs) {
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("keeps the `data-testid='cloudstash-logo'` handle", () => {
    const { container } = render(<CloudStashLogo />);
    expect(
      container.querySelector("[data-testid='cloudstash-logo']"),
    ).not.toBeNull();
  });

  it("honours the `size` prop on both mark images' width and height", () => {
    const { container } = render(<CloudStashLogo size={40} />);
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs).toHaveLength(2);
    for (const img of imgs) {
      expect(img.getAttribute("width")).toBe("40");
      expect(img.getAttribute("height")).toBe("40");
    }
  });

  it("defaults `size` to 28", () => {
    const { container } = render(<CloudStashLogo />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("width")).toBe("28");
    expect(img.getAttribute("height")).toBe("28");
  });
});

describe("CloudStashGlyph — currentColor glyph for 16–32px surfaces", () => {
  it("renders an inline <svg> whose paths stroke with currentColor (theme-foreground tintable)", () => {
    const { container } = render(<CloudStashGlyph />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("data-testid")).toBe("cloudstash-glyph");
    const strokedPaths = Array.from(svg!.querySelectorAll("path")).filter(
      (p) => p.getAttribute("stroke") === "currentColor",
    );
    // The pack glyph is two currentColor-stroked paths (outline + seam).
    expect(strokedPaths.length).toBeGreaterThanOrEqual(2);
  });

  it("exposes role='img' and a 'CloudStash' accessible name", () => {
    const { getByRole } = render(<CloudStashGlyph />);
    expect(getByRole("img", { name: /CloudStash/i })).toBeInTheDocument();
  });

  it("honours the `size` prop", () => {
    const { container } = render(<CloudStashGlyph size={20} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
  });
});

describe("served dark-mark asset — filter region covers the full artwork", () => {
  // Regression guard for the left-truncation bug: the `innerGlow` filter used
  // `filterUnits="userSpaceOnUse"` with a region (x=130 … width=780) that
  // clipped the cloud, whose geometry spans x≈62..929 and y≈205..825. Anything
  // outside the filter rect is not painted, so the left bulge + front pocket
  // (x<130) and the right lobe edge (x>910) were cut off — visible as the dark
  // mark being sliced on the left while the light mark (unbounded filter
  // region) rendered whole. The region MUST fully contain the geometry.
  const CLOUD_MIN_X = 62;
  const CLOUD_MAX_X = 929;
  const CLOUD_MIN_Y = 205;
  const CLOUD_MAX_Y = 825;

  function readInnerGlowRegion() {
    const svg = readFileSync(MARK_DARK_ASSET_PATH, "utf8");
    const tag = svg.match(/<filter\s+id="innerGlow"[^>]*>/);
    expect(tag, "innerGlow filter must exist").not.toBeNull();
    const attr = (name: string) => {
      const m = tag![0].match(new RegExp(`${name}="(-?[0-9.]+)"`));
      return m ? Number(m[1]) : NaN;
    };
    return {
      x: attr("x"),
      y: attr("y"),
      width: attr("width"),
      height: attr("height"),
    };
  }

  it("innerGlow region's left/right edges enclose the cloud's horizontal span", () => {
    const r = readInnerGlowRegion();
    expect(r.x).toBeLessThanOrEqual(CLOUD_MIN_X);
    expect(r.x + r.width).toBeGreaterThanOrEqual(CLOUD_MAX_X);
  });

  it("innerGlow region's top/bottom edges enclose the cloud's vertical span", () => {
    const r = readInnerGlowRegion();
    expect(r.y).toBeLessThanOrEqual(CLOUD_MIN_Y);
    expect(r.y + r.height).toBeGreaterThanOrEqual(CLOUD_MAX_Y);
  });
});

describe("cloudstash-logo source — colour-literal ban", () => {
  it("source file contains no hex/rgb/hsl/oklch colour literals", () => {
    const source = readFileSync(LOGO_SRC_PATH, "utf8");
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3}(?![0-9a-fA-F])/);
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/);
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{8}(?![0-9a-fA-F])/);
    expect(stripped).not.toMatch(/\brgba?\s*\(/);
    expect(stripped).not.toMatch(/\bhsla?\s*\(/);
    expect(stripped).not.toMatch(/\boklch\s*\(/);
    expect(stripped).not.toMatch(/\boklab\s*\(/);
  });
});
