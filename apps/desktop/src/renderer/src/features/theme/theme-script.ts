/**
 * Pre-paint theme bootstrap script.
 *
 * This string is injected into the document `<head>` via
 * `dangerouslySetInnerHTML` on a bare `<script>` tag so it runs
 * synchronously *before* React mounts — no FOUC on cold start.
 *
 * Constraints:
 *  - Plain ES5-ish JS only. No TypeScript, no modules, no React, no
 *    closures over undeclared globals. It must parse and run in a raw
 *    browser context AND in a jsdom test harness where we `eval` it.
 *  - Any error is swallowed silently; the fallback is to leave the
 *    class list alone and let React's first paint apply the default.
 *  - The storage key is duplicated here (not imported from
 *    `theme-store.ts`) because an inline `<script>` has no module
 *    resolution. Keep the two in sync — the `no-fouc.test.tsx` guards
 *    the effective behaviour and the 4.4 theme test keeps the class
 *    name (`.dark`) canonical.
 */
// CloudStash Monochrome resolves to exactly two palettes: Light (no class) and
// the canonical graphite Dark (`.dark` on <html>). The bootstrap only ever
// adds or removes `.dark` — an explicit stored "dark"/"light" wins, otherwise
// it falls back to `prefers-color-scheme`. Mirrors `applyEffectiveTheme()` in
// theme-store.ts. ES5-safe: `var`, no arrow fns, no optional chaining.
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k="cloudstash.theme";var v=null;try{v=window.localStorage.getItem(k)}catch(_){v=null}var d=document.documentElement;var eff;if(v==="dark"||v==="light"){eff=v}else{var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)");eff=(m&&m.matches)?"dark":"light"}if(eff==="dark"){d.classList.add("dark")}else{d.classList.remove("dark")}}catch(_){}})();`
