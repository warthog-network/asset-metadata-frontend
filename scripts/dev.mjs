// Dev server for the static frontend — the thing that actually ships to
// Netlify. Serves dist/ on http://localhost:4000 and rebuilds on save:
//
//   public/js/**        -> esbuild rebuild (watch)
//   public/css/app.css  -> tailwind rebuild (watch)
//   src/page.ts         -> index.html re-render
//
// The API stays on the VPS, exactly as in production. Override with
// API_BASE_URL=... npm run dev to point somewhere else.

import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import { watch, existsSync } from "node:fs";

const PORT = Number(process.env.PORT || 4000);
const API_BASE_URL =
  process.env.API_BASE_URL || "https://warthog-defitestnet.duckdns.org:4445";

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

// Reuse scripts/build-static.ts so dev and the Netlify build agree on the
// output layout. It's TypeScript importing an extensionless module, so it
// gets bundled first, then imported with a cache-busting query to pick up
// edits. HTML_ONLY leaves the live-rebuilt css/js in dist/ alone.
process.env.HTML_ONLY = "1";
process.env.API_BASE_URL = API_BASE_URL;

async function renderHtml() {
  try {
    await esbuild.build({
      entryPoints: ["scripts/build-static.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: ".build/build-static.mjs",
      logLevel: "silent",
    });
    await import(`../.build/build-static.mjs?t=${Date.now()}`);
  } catch (err) {
    log("html", "FAILED\n" + (err.stderr?.toString() || err.message));
  }
}

// 1. Page markup.
await renderHtml();

// 2. Tailwind, straight into dist/ so no copy step can serve a stale file.
//
// stdin must be an open pipe: with "ignore" the CLI sees a closed stdin,
// exits 0 immediately, and dist/css/app.css is never written (the page
// then loads with no styles at all). Leaving the pipe unwritten keeps it
// open for the life of this process.
const tw = spawn(
  "npx",
  ["tailwindcss", "-i", "./public/css/app.css", "-o", "./dist/css/app.css", "--watch"],
  { stdio: ["pipe", "ignore", "inherit"] },
);
tw.on("exit", (code) => {
  if (code !== 0 && code !== null) log("css", `tailwind exited (${code})`);
});

// 3. JS bundle + static file server.
const ctx = await esbuild.context({
  entryPoints: ["public/js/app.js"],
  bundle: true,
  outfile: "dist/js/app.js",
  external: ["/fonts/*", "/images/*"],
  sourcemap: true,
  logLevel: "info",
});

await ctx.watch();

// 4. Re-render the page when its template changes.
const HOME = "src/page.ts";
if (existsSync(HOME)) {
  let pending = null;
  watch(HOME, () => {
    clearTimeout(pending);
    // Editors fire several events per save; coalesce them.
    pending = setTimeout(() => void renderHtml(), 50);
  });
}

const { host, port } = await ctx.serve({ servedir: "dist", port: PORT });

const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host;
console.log(`
  Warthog Asset Metadata — frontend dev server

  ➜  Local:   http://${shown}:${port}/
  ➜  API:     ${API_BASE_URL}  (remote, not proxied)

  Watching public/js, public/css, and ${HOME}.
`);

const shutdown = async () => {
  tw.kill();
  await ctx.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
