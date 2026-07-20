import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

// Favicon / window icon wiring (restyle-cloudstash-monochrome §4.2). The
// CloudStash Monochrome app-tile SVG (graphite tile + cloud/silver-fold mark)
// is vendored to public/brand/ and referenced via Next `metadata.icons`, so the
// running app's browser-tab / window icon is the CloudStash mark, not the
// electron/Next default. File-as-text (same pattern as typography.test.ts):
// metadata is a compile-time export, so we assert on the source.
//
// The rasterised OS icon pack (ico/icns/png + electron-builder `icon:` wiring)
// is a packaged-build follow-up tracked in PENDING_TC — out of this dev cycle's
// verification scope; the SVG sources ship here for it.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RENDERER_ROOT = join(__dirname, "..", "..", "..");
const LAYOUT_PATH = join(RENDERER_ROOT, "src", "app", "layout.tsx");
const FAVICON_PATH = join(RENDERER_ROOT, "public", "brand", "cloudstash-app-tile-dark.svg");
const FAVICON_HREF = "/brand/cloudstash-app-tile-dark.svg";

describe("favicon — CloudStash app-tile icon wiring", () => {
  it("ships the app-tile favicon SVG under public/brand/", () => {
    expect(existsSync(FAVICON_PATH)).toBe(true);
  });

  it("layout.tsx wires metadata.icons to the app-tile favicon", () => {
    const text = readFileSync(LAYOUT_PATH, "utf8");
    expect(text).toMatch(
      /icons\s*:\s*\{[^}]*icon\s*:\s*["']\/brand\/cloudstash-app-tile-dark\.svg["']/,
    );
  });

  it("references the favicon by an app://-resolvable root-relative path", () => {
    // basePath is "", so a root-relative href resolves against the app://local
    // origin (app://local/brand/…) → <rendererRoot>/brand/… served by the
    // custom protocol. No external host.
    expect(FAVICON_HREF.startsWith("/")).toBe(true);
    expect(FAVICON_HREF).not.toMatch(/^https?:/);
  });
});
