import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

// Main and preload compile through Vite/Rollup into CJS modules under
// `dist/main` and `dist/preload`. The renderer is intentionally omitted
// from this config: Next.js 16 emits a fully static bundle to
// `src/renderer/out/` via `next build`, and electron-builder picks it up
// through `extraResources` in `electron-builder.yml`. Bundling the renderer
// through electron-vite would duplicate work and fight the Next toolchain.
//
// OAuth credentials note: the previous build-time `__FT5_GOOGLE_OAUTH_*`
// `define` injection is gone as of `implement-datasource-onboarding` §18.5
// — the OAuth consent broker has been relocated from the desktop main
// process to the fs-sync service per design.md Decision 2, and the service
// reads its OAuth app config from `~/cloudstash/sync_app/config.json` per
// Decision 4. The desktop process no longer carries provider clientId /
// clientSecret values; the `FT5_GOOGLE_OAUTH_CLIENT_ID` /
// `FT5_GOOGLE_OAUTH_CLIENT_SECRET` env vars are deprecated and are no
// longer consumed by this build.

export default defineConfig({
  main: {
    plugins: [
      // Externalize runtime deps EXCEPT the engine and its provider SDK
      // chain. The engine pulls in `@aws-sdk/*` (which transitively pulls
      // ~50 `@smithy/*` packages) and `googleapis` — pnpm's content-
      // addressable store keeps these under `<repo>/node_modules/.pnpm/`,
      // OUTSIDE this workspace's `node_modules/`. electron-builder's
      // file walker only sees the desktop workspace tree, so externalized
      // requires fail at packaged runtime with `Cannot find module
      // '@smithy/util-buffer-from'` (and similar). Bundling the engine
      // pulls all transitives into `dist/main/index.js` so there's no
      // runtime resolution to miss. Native modules + electron itself
      // remain externalized — those need to be loaded via host bindings.
      externalizeDepsPlugin({
        exclude: ["@cloudstash/fs-datasource-engine"],
      }),
    ],
    build: {
      // `outDir` is the shared parent so this one build can emit TWO
      // programs — see the service entry below. `entryFileNames: "[name].js"`
      // maps each input key straight to its path, so `main/index` still lands
      // at `dist/main/index.js` exactly as before (and as `package.json`'s
      // `main` field requires).
      outDir: "dist",
      // `lib` mode is deliberately NOT used here: it takes a single entry and
      // a `fileName` that cannot express two outputs in different directories.
      // `rollupOptions.input` does, and electron-vite's main config already
      // targets Node, so nothing else about lib mode is load-bearing.
      rollupOptions: {
        input: {
          "main/index": resolve(__dirname, "src/main/index.ts"),
          // wire-packaged-build-fs-sync-service §2 — the fs-sync service is
          // emitted as a SECOND program in this build so it ships INSIDE
          // `app.asar`. That placement is the whole point: Node resolution
          // from a loose `<resources>/fs-sync/` never walks into
          // `app.asar/node_modules`, so a service sitting there cannot find
          // `drizzle-orm` or the engine. From inside the archive, ordinary
          // resolution applies, and `better-sqlite3` reaches its unpacked
          // copy through Electron's automatic asar→unpacked native redirect
          // (design.md Decision 2).
          //
          // The input is the service's BUILT output, not its TypeScript. The
          // service stays compiled by its own tsconfig under its own
          // framework-agnostic rules; this build only bundles an artifact
          // that already exists (design.md Decision 3). `prebuild` builds it
          // first so it can never be stale.
          "service/index": resolve(__dirname, "../../services/fs-sync/dist/main/index.js"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    // Exclude `@cloudstash/ipc-contracts` from externalization so it's bundled
    // into the preload's CJS output. Electron's sandboxed preload context
    // can only resolve "electron" at runtime; any other specifier left as
    // a runtime `require(...)` (the default behavior of
    // externalizeDepsPlugin) will fail with "module not found" inside the
    // sandbox and silently break `window.api` exposure. Regression guard
    // lives at `scripts/preload-bundle.test.ts`.
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@cloudstash/ipc-contracts", "@cloudstash/ipc-contracts/sync-service-desktop"],
      }),
    ],
    build: {
      outDir: "dist/preload",
      lib: {
        entry: resolve(__dirname, "src/preload/index.ts"),
        formats: ["cjs"],
        fileName: () => "index.js",
      },
      rollupOptions: {
        output: { format: "cjs" },
      },
    },
  },
});
