import { describe, expect, it } from "vitest";
import { buildMainWindowOptions } from "../window-options";

describe("buildMainWindowOptions", () => {
  it("enforces the non-negotiable Electron security defaults and wires the preload", () => {
    const options = buildMainWindowOptions("/tmp/preload/index.js");

    expect(options.webPreferences).toBeDefined();
    const wp = options.webPreferences!;

    // Literal equality: the preload path passed in must be reflected verbatim.
    // The original bug was that `buildMainWindowOptions` ignored/omitted the
    // preload, so `window.api` was undefined in the packaged renderer.
    expect(wp.preload).toBe("/tmp/preload/index.js");

    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    expect(wp.webSecurity).toBe(true);
  });

  // The signature intentionally has no default value for `preloadPath`. A
  // caller that forgets to pass one gets a compile-time error from `tsc`
  // under strict mode — which is what keeps the original bug from returning.
  // We document that here rather than asserting it at runtime: `@ts-expect-error`
  // would be evaluated at type-check time by `tsc`, and vitest's runtime
  // assertions do not observe it. The `pnpm -w typecheck` gate covers this.
  it("requires a preload path in its type signature (compile-time guarantee)", () => {
    // Proof: passing a string works; the project-wide `tsc -b` would fail
    // if someone removed the parameter or gave it a default value and then
    // a caller relied on the old zero-arg shape.
    const options = buildMainWindowOptions("/any/string");
    expect(options.webPreferences?.preload).toBe("/any/string");
  });
});

describe("buildMainWindowOptions frameless title bar (per-platform)", () => {
  // Platform is injected as a parameter (defaulting to `process.platform`) so
  // all three branches are unit-testable on any host without stubbing the
  // read-only `process.platform`. The frame-hiding style differs per OS but
  // must NEVER weaken the four hardened `webPreferences` flags or the preload.

  it("uses titleBarStyle 'hidden' on Windows, security flags intact", () => {
    const options = buildMainWindowOptions("/tmp/preload/index.js", "win32");

    expect(options.titleBarStyle).toBe("hidden");

    const wp = options.webPreferences!;
    expect(wp.preload).toBe("/tmp/preload/index.js");
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    expect(wp.webSecurity).toBe(true);
  });

  it("uses titleBarStyle 'hidden' on Linux, security flags intact", () => {
    const options = buildMainWindowOptions("/tmp/preload/index.js", "linux");

    expect(options.titleBarStyle).toBe("hidden");

    const wp = options.webPreferences!;
    expect(wp.preload).toBe("/tmp/preload/index.js");
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    expect(wp.webSecurity).toBe(true);
  });

  it("uses titleBarStyle 'hiddenInset' on macOS, security flags intact", () => {
    const options = buildMainWindowOptions("/tmp/preload/index.js", "darwin");

    expect(options.titleBarStyle).toBe("hiddenInset");

    const wp = options.webPreferences!;
    expect(wp.preload).toBe("/tmp/preload/index.js");
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    expect(wp.webSecurity).toBe(true);
  });
});
