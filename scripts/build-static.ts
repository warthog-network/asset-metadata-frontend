// Static site build for Netlify.
//
// This repo is frontend-only: the page is rendered once at build time with
// an absolute API URL baked into the form's action. The backend (submission,
// wallet challenge, and the asset catalog) is the Elixir/Phoenix service on
// the VPS, which lives on a different origin.
//
// Output layout matches the paths referenced in src/page.ts:
//
//   dist/index.html
//   dist/css/app.css
//   dist/js/app.js
//   dist/images/warthog-mark.svg

import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { renderHome } from "../src/page";

// Where the Phoenix backend lives. Override per-deploy with the
// API_BASE_URL build environment variable in Netlify.
const API_BASE_URL =
  process.env.API_BASE_URL || "https://warthog-defitestnet.duckdns.org:4445";

const OUT = "dist";

const apiUrl = `${API_BASE_URL.replace(/\/$/, "")}/api/submit`;

// In dev, esbuild and Tailwind write straight into dist/ and keep those
// files fresh, so copying the public/assets snapshots over them would
// serve stale output. HTML_ONLY re-renders just the page.
const htmlOnly = process.env.HTML_ONLY === "1";

mkdirSync(`${OUT}/css`, { recursive: true });
mkdirSync(`${OUT}/js`, { recursive: true });
mkdirSync(`${OUT}/images`, { recursive: true });

writeFileSync(`${OUT}/index.html`, renderHome(apiUrl));
copyFileSync("public/images/warthog-mark.svg", `${OUT}/images/warthog-mark.svg`);

if (!htmlOnly) {
  copyFileSync("public/assets/app.css", `${OUT}/css/app.css`);
  copyFileSync("public/assets/app.js", `${OUT}/js/app.js`);
}

console.log(
  htmlOnly
    ? `index.html -> ${OUT}/  (API: ${apiUrl})`
    : `static site -> ${OUT}/  (API: ${apiUrl})`,
);
