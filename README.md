# Warthog Asset Metadata — frontend

The submission form for Warthog asset metadata. A single static page: unlock a
Warthog wallet in the browser, fill in the asset's metadata, attach a logo and
optional banner, and publish.

**This repo is frontend-only.** It has no server and no database. The API and
all stored data belong to the Elixir/Phoenix service on the VPS, which owns
submission, the wallet challenge, and the published asset catalog. This repo
builds to static files and deploys to Netlify.

```
browser (Netlify)                          VPS (Phoenix + Postgres)
  index.html + app.js  ──── POST /api/submit ─────────►  publish to catalog
                       ──── GET  /api/auth/challenge ─►  one-time nonce
  /assets.json         ──── proxied by Netlify ───────►  the public catalog
  /assets/<hash>/...   ──── proxied by Netlify ───────►  serve metadata
  autocomplete         ──── GET  /asset/complete ─────►  Warthog node (direct)
```

The API calls go straight to the VPS cross-origin. The catalog is the
exception: wallets and explorers expect it on an origin of their own, so
`dist/_redirects` rewrites it through to the backend — both on this site and on
`assets.warthog.network`, where the hash sits at the root (see **Deploy**).

## Quick start

```sh
npm install
npm run dev      # -> http://localhost:4000
```

Node only — no Bun required. Rebuilds on save:

| Edit | Rebuilds |
|---|---|
| `public/js/**` | esbuild bundle |
| `public/css/app.css` | Tailwind |
| `src/page.ts` | `index.html` |

The API is **not** proxied. The form posts to `API_BASE_URL` (the VPS) exactly
as in production, so wallet unlock and submission are testable end to end from
localhost. The backend returns CORS headers for the requesting origin, so
`http://localhost:4000` works with no configuration.

Point it elsewhere with `API_BASE_URL=http://localhost:4010 npm run dev`.

## Deploy

`netlify.toml` is already configured — connect the repo and Netlify runs:

```sh
npm run build:netlify   # -> dist/
```

Three steps: Tailwind, the esbuild bundle, then `scripts/build-static.ts`,
which renders `src/page.ts` once and writes `dist/`.

Because the page is rendered at build time it cannot derive the API URL from
the request host, so the URL is baked into the form's `action`:

| Build env var | Default |
|---|---|
| `API_BASE_URL` | `https://warthog-defitestnet.duckdns.org:4445` |
| `CATALOG_BASE_URL` | falls back to `API_BASE_URL` |
| `CATALOG_HOST` | unset (no host-scoped rules) |

### The catalog proxy

A static host has no `/assets.json` to serve, so the path 404s on its own. The
build writes `dist/_redirects` with `200!` rewrites — a rewrite, not a
redirect, so the URL stays on the requested origin and the backend's CORS and
cache headers pass through untouched.

Two path shapes are served:

| Where | Path | Proxied to |
|---|---|---|
| every domain | `/assets.json` | `<CATALOG_BASE_URL>/assets.json` |
| every domain | `/assets/<hash>/<file>` | the same path upstream |
| `CATALOG_HOST` only | `/<hash>/<file>` | `/assets/<hash>/<file>` upstream |
| `CATALOG_HOST` only | `/` | `/assets.json` — a data host answers with the catalog, not the form |

`<file>` is one of `info.json`, `logo.png`, `image.png` (a logo alias), or
`banner.png`.

The root-hash shape is scoped to `CATALOG_HOST` with an absolute `from` URL, so
a bare `/<something>/logo.png` can never shadow a page on the main form site.
Rules are first-match-wins and the host block is emitted first.

**`CATALOG_HOST` must also be added to the Netlify site** under Domain
management. Netlify only applies a domain-scoped rule for a domain assigned to
the site; without that the requests never reach these rules at all.

`CATALOG_BASE_URL` exists separately from `API_BASE_URL` for one reason:
Netlify's proxy only handles ports 80 and 443, and the API URL carries `:4445`.
`netlify.toml` points it at the same Phoenix app on 443 — the VPS `nginx` vhost
exposes the catalog there deliberately, for exactly this. The browser still
talks to `:4445` directly for `/api/*`, where no proxy is involved.

The dev server doesn't apply `_redirects` — `npm run dev` serves `dist/` with
esbuild, so `/assets.json` 404s locally. Read it from the backend origin
directly when testing.

`public/js/wallet.js` reads that same absolute URL back off the form action, so
the wallet challenge and the submission always target the same origin.

**Cross-origin.** Netlify puts the frontend on a different origin from the API.
Every request the frontend makes is CORS-simple (no custom headers), so no
preflight is involved and no backend change is needed.

## How a submission works

1. The user unlocks a wallet in-page — saved wallet, wallet file, seed phrase,
   or private key. The private key never leaves the browser.
2. Typing a 64-hex asset hash triggers a lookup against the selected Warthog
   node and auto-fills the ticker. Shorter prefixes run autocomplete. Both go
   browser → node directly; the node sends `access-control-allow-origin: *`.
3. Images are re-encoded client-side to exactly 250×250 (logo) or 600×200
   (banner) PNG via `<canvas>`, because the backend accepts only those exact
   dimensions and does no resizing of its own.
4. On submit, the page fetches a one-time challenge, signs it, and POSTs
   `multipart/form-data` with `wallet_nonce` + `wallet_signature`.
5. The backend verifies the signature against the asset's on-chain creator and
   publishes. Success returns `infoUrl`; the page swaps the form for a summary.

Only the asset's on-chain creator can publish its metadata — anyone else gets
`403 not_owner`.

## Backend contract

Owned by the Phoenix service, documented here because the form depends on it.

### `POST /api/submit`

`multipart/form-data`, always returns JSON.

| Field | Required | Type | Notes |
|---|---|---|---|
| `asset_hash` | yes | 64 hex chars | Must exist on chain |
| `name` | yes | string ≤ 15 chars | Human-readable long name |
| `description` | yes | string ≤ 500 chars | |
| `website` | no | `https://` URL ≤ 2048 chars | |
| `telegram` | no | `https://` URL ≤ 2048 chars | |
| `discord` | no | `https://` URL ≤ 2048 chars | |
| `twitter` | no | `https://` URL ≤ 2048 chars | |
| `logo` | yes | PNG or JPEG, exactly 250×250 px | Re-encoded client-side |
| `banner` | no | PNG or JPEG, exactly 600×200 px | Re-encoded client-side |
| `wallet_nonce` | yes | string | From `/api/auth/challenge` |
| `wallet_signature` | yes | 130 hex chars | `r + s + recid` over `sha256(message)` |

All four URL fields must start with `https://` — the metadata is served
publicly, and HTTP-only links cause mixed-content warnings.

Success (201):

```json
{
  "ok": true,
  "assetHash": "c2aa…d297",
  "infoUrl": "https://warthog-defitestnet.duckdns.org:4445/assets/c2aa…d297/info.json"
}
```

Error (4xx/5xx):

```json
{ "ok": false, "error": "logo: must be exactly 250x250 px, got 300x300 px" }
```

The server re-validates everything the browser checked — never trust the client.

### `GET /api/auth/challenge?asset_hash=<hash>`

Returns `{ ok, message, nonce, expiresIn }`. The message is bound to the host
and the asset, so a signature cannot be replayed against another token.

### `GET /assets.json`, `GET /assets/<hash>/{info.json,logo.png,banner.png}`

The public catalog. Open CORS so wallets and explorers can read it. Netlify
rewrites both paths through to the backend, so they answer on the frontend
origin too — see **The catalog proxy**.

## Layout

```
public/
├── js/
│   ├── app.js            # entry point; mounts the modules below
│   ├── submit.ts         # form submit, image re-encode, wallet proof
│   ├── wallet.js         # in-page unlock + signature65
│   ├── walletCrypto.js   # wallet blob decryption (WartBunker formats)
│   ├── autocomplete.js   # hash autocomplete + ticker lookup
│   └── node-picker.ts    # node picker UI
├── css/app.css           # Tailwind entry
└── images/
src/
├── page.ts               # the entire page, rendered at build time
└── lib/node-picker.ts    # node list/cache/render helpers
scripts/
├── build-static.ts       # renders src/page.ts -> dist/
└── dev.mjs               # dev server (serve + watch + rebuild)
```

## Notes

`src/lib/node-picker.ts` fetches `/api/node-health` for per-node alive/version
badges. Nothing serves that path on a static host, so the request 404s — this
is handled, and the picker renders its node list without badges. Add a Netlify
function at that path to light them up.
