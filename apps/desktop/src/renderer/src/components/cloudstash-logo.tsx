// CloudStash brand mark — CloudStash Monochrome identity
// (restyle-cloudstash-monochrome §4.1, design.md Decision 3).
//
// The mark is multi-gradient 3D artwork (a layered cloud + folded silver
// ribbon seam), NOT a single `currentColor`-tintable shape. So it ships as
// fixed .svg asset files (in `public/brand/`, served at `app://local/brand/…`)
// and is swapped by theme rather than tinted through a token. Two forms:
//
//   • CloudStashLogo — the full mark for the header/chrome. Renders the
//     dark-optimised mark on the dark theme and the light-optimised mark on
//     the light theme as two <img> elements, toggled PURELY by CSS via the
//     `.dark`-class Tailwind variant (`hidden dark:block` / `block dark:hidden`).
//     `.dark` is already on <html> before first paint, so the swap is
//     FOUC-free with no JS theme read. <img> (not inline SVG) is deliberate:
//     the two mark files reuse SVG element ids (`fold`, …); inlining both into
//     one DOM would collide, whereas <img> scopes each file's ids.
//
//   • CloudStashGlyph — the 16–32px surface variant (favicon/tray). A single
//     inline <svg> whose two paths stroke with `currentColor`, so it inherits
//     the theme foreground at small sizes.
//
// Accessibility: with a CSS display-swap, exactly one <img> is `display:none`
// per theme, and a `display:none` element drops out of the accessibility tree.
// So the "CloudStash" name must NOT live on either <img> (it would vanish in
// the theme where that img is hidden — including the canonical dark theme).
// It lives on the wrapper (`role="img"` + `aria-label`), which is never
// display:none; both mark images are decorative (`alt="" aria-hidden`). Result:
// exactly one accessible name, stable across the swap.
//
// Colour-literal ban: NO hex/rgb/hsl/oklch literal appears in this file. The
// mark hex lives only in the .svg asset files; the glyph uses `currentColor`
// and `fill="none"` (neither is a colour literal).

import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

export interface CloudStashLogoProps {
  /**
   * Pixel size applied as the width and height of the mark images. The mark
   * artwork is a square 1024 viewBox, so width === height. Defaults to 28
   * (the app-header chrome size).
   */
  size?: number;
  /** Optional extra classes merged onto the wrapper. */
  className?: string;
}

// Asset paths resolve root-relative against the `app://local` origin the
// renderer is loaded from (`app://local/brand/…` → `<rendererRoot>/brand/…`).
// `basePath` is "" so no prefix is needed.
const MARK_DARK_SRC = "/brand/cloudstash-mark-dark.svg";
const MARK_LIGHT_SRC = "/brand/cloudstash-mark-light.svg";

export function CloudStashLogo({ size = 28, className }: CloudStashLogoProps) {
  return (
    <span
      role="img"
      aria-label="CloudStash"
      data-testid="cloudstash-logo"
      className={cn("inline-flex shrink-0", className)}
    >
      {/* Dark-optimised mark: hidden on light, shown on dark. */}
      <img
        src={MARK_DARK_SRC}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className="hidden dark:block"
      />
      {/* Light-optimised mark: shown on light, hidden on dark. */}
      <img
        src={MARK_LIGHT_SRC}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className="block dark:hidden"
      />
    </span>
  );
}

export interface CloudStashGlyphProps
  extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  /** Pixel size for both width and height (square 1024 viewBox). Defaults to 24. */
  size?: number;
}

// Two path d-values copied verbatim from the pack `cloudstash-glyph.svg`
// (outline + fold seam). Both stroke with currentColor so the glyph inherits
// the theme foreground.
const GLYPH_OUTLINE_D =
  "M193 670C116 665 62 607 62 535C62 458 126 396 207 394C225 287 318 205 431 205C534 205 622 273 649 368C677 354 710 346 744 346C846 346 929 426 929 524C929 622 846 702 744 702H246C227 702 209 690 193 670Z";
const GLYPH_SEAM_D =
  "M197 410C317 431 434 491 548 583C628 647 684 650 754 613C724 662 681 695 619 697C561 699 519 670 466 627C359 539 278 458 197 410Z";

export function CloudStashGlyph({
  size = 24,
  role = "img",
  "aria-label": ariaLabel = "CloudStash",
  ...rest
}: CloudStashGlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      fill="none"
      role={role}
      aria-label={ariaLabel}
      data-testid="cloudstash-glyph"
      {...rest}
    >
      <path
        d={GLYPH_OUTLINE_D}
        stroke="currentColor"
        strokeWidth={58}
        strokeLinejoin="round"
      />
      <path
        d={GLYPH_SEAM_D}
        stroke="currentColor"
        strokeWidth={48}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
