# Warthog Asset Metadata — frontend

The submission form for Warthog asset metadata. A single static page: unlock a
Warthog wallet in the browser, fill in the asset's metadata, attach a logo and
optional banner, and publish.

**Website:** <https://testnet-assets.warthog.network/>

**This repo is frontend-only.** It has no server and no database. The API and
all stored data belong to the Elixir/Phoenix service on the VPS, which owns
submission, the wallet challenge, and the published asset catalog. This repo
builds to static files and deploys to Netlify.

```
browser                     Netlify edge              VPS (Phoenix + Postgres)
  index.html + app.js
  POST /api/submit      ──── rewrite ────────────────►  publish to catalog
  GET  /api/auth/challenge ─ rewrite ────────────────►  one-time nonce
  GET  /assets.json     ──── rewrite ────────────────►  the public catalog
  GET  /assets/<hash>/… ──── rewrite ────────────────►  serve metadata
  GET  /<hash>/…        ──── rewrite ────────────────►  /assets/<hash>/…
  autocomplete ─────────────────────────────────────►  Warthog node (direct)
```

Nothing the browser calls is cross-origin in production: Netlify rewrites
`/api/*` and the catalog through to the VPS, so the page emits relative URLs
(see **Deploy**). The website and the catalog share one host: `/` is the
submission form, and the catalog answers under it — with the asset hash at the
root (`/<hash>/logo.png`) as well as under `/assets/`.

## API

For programmatic submission of asset metadata, see [docs/api.md](docs/api.md).
The detailed request/response shapes and `/api/*` envelope codes are documented
below in **Backend contract**.

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

The dev server applies no rewrites. `API_BASE_URL` is unset here, so it keeps
its absolute default and the form posts straight to the VPS — wallet unlock and
submission are testable end to end from localhost. The backend returns CORS
headers for the requesting origin, so `http://localhost:4000` works with no
configuration. Production differs: there the same calls are same-origin,
rewritten by Netlify.

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

| Build env var | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | `https://warthog-defitestnet.duckdns.org:4445` | baked into the form `action`; `""` on Netlify means same-origin |
| `CATALOG_BASE_URL` | `https://warthog-defitestnet.duckdns.org` | origin the catalog is proxied *from* |
| `CATALOG_HOST` | unset — no `_redirects` written | a data-only host whose bare `/` is the catalog, not the form |

### The proxy rules

A static host has no `/assets.json` or `/api/submit` to serve, so those paths
404 on their own. Every rule is a `200` rewrite, not a redirect: the URL stays
on the requested origin and the backend's CORS and cache headers pass through
untouched. The rules live in two places, and the split is not cosmetic —
**`netlify.toml` rules take precedence over `_redirects`**:

| Declared in | Path | Applies on |
|---|---|---|
| `netlify.toml` | `/api/{submit,complete,auth/challenge}` | every domain |
| `netlify.toml` | `/assets.json`, `/assets/<hash>/<file>` | every domain |
| `netlify.toml` | `/<hash>/<file>` — hash at the root | every domain |
| `dist/_redirects` | `/` → the catalog | `CATALOG_HOST` only — unset in production |

`<file>` is one of `info.json`, `logo.png`, `image.png` (a logo alias), or
`banner.png`. Both shapes answer everywhere, so the catalog is reachable as
`/assets/<hash>/logo.png` or `/<hash>/logo.png` on any domain the site serves.

The root-hash shape being unscoped has a cost worth knowing: `/:hash/<file>`
matches **any** single segment, so `/<anything>/info.json`, `/logo.png`,
`/image.png` and `/banner.png` are reserved paths sitewide. That is harmless
while this is one page with no router, but a future page must not use those
two-segment shapes.

One rule can be hostname-scoped, and `netlify.toml` cannot express it: a
data-only host where a bare `/` answers with the catalog rather than the
submission form. `scripts/build-static.ts` emits that to `dist/_redirects` with
an absolute `from` URL, and only when `CATALOG_HOST` names such a host.

**`CATALOG_HOST` is unset, and must stay unset while the catalog shares a host
with the website.** The generated rule is a forced rewrite (`200!`), so it
outranks `dist/index.html`: point it at the host that serves the form and that
homepage becomes raw JSON. Nothing is lost by leaving it unset — every rule in
the table above is sitewide, so the whole catalog, root-hash shape included,
still answers on this domain. Only `/` differs, and there it must be the form.

Set it only for a genuinely separate data host, and **add that host to the
Netlify site** under Domain management. Netlify routes by `Host` header; a
domain not assigned to the site gets Netlify's own 404 and no rule is consulted
at all. DNS alone is not enough. If the domain sits behind Cloudflare, start
DNS-only (grey cloud) — proxying blocks Netlify's certificate challenge.

`CATALOG_BASE_URL` is independent of `API_BASE_URL` because neither value
`API_BASE_URL` takes is a usable rewrite target: it's `""` (same origin) on
Netlify and carries `:4445` elsewhere, and Netlify's proxy only speaks ports
80 and 443. The VPS `nginx` vhost exposes the catalog on 443 deliberately, for
exactly this.

The dev server applies neither file — `npm run dev` serves `dist/` with
esbuild, so `/assets.json` and `/api/*` 404 locally. Dev builds with an unset
`API_BASE_URL`, so the form still points at the absolute backend URL and
submission works end to end; read the catalog from the backend origin directly.

`public/js/wallet.js` reads that same absolute URL back off the form action, so
the wallet challenge and the submission always target the same origin.

**Same-origin in production.** Netlify proxies `/api/*` to the VPS, so the
browser never makes a cross-origin request and CORS is not involved at all.
Running without the proxy (dev, or a deploy with an absolute `API_BASE_URL`) is
still cross-origin, but every request the frontend makes is CORS-simple — no
custom headers, so no preflight and no backend change is needed.

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

**Two surfaces, two conventions.** Everything under `/api/*` is enveloped:

```
{"ok": true,  "data":  {...}}
{"ok": false, "error": {"code": "...", "message": "..."}}
```

The public catalog is not. `/assets.json` and `/assets/<hash>/info.json` return
the resource itself, because they are file-shaped URLs whose siblings
(`logo.png`, `banner.png`) are binary and could never carry an envelope. Only
their *error* bodies use the enveloped form, so a failure looks the same
everywhere.

The HTTP status is authoritative in both cases — the envelope repeats it, it
does not replace it. This differs from the Warthog node, which answers errors
with `200` and a numeric `code`. nginx, Netlify's edge and Cloudflare all cache
on status here, and the catalog is served `max-age=300`, so an error returned
as `200` would be cached as a success.

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
  "data": {
    "assetHash": "c2aa…d297",
    "infoUrl": "https://warthog-defitestnet.duckdns.org/assets/c2aa…d297/info.json",
    "logoUrl": "…",
    "bannerUrl": "…"
  }
}
```

Error (4xx/5xx):

```json
{
  "ok": false,
  "error": {
    "code": "wrong_dimensions",
    "message": "logo: must be exactly 250x250 px, got 300x300 px"
  }
}
```

`code` is stable and safe to branch on; `message` is human-facing and may be
reworded. Known codes: `invalid_hash`, `invalid_name`, `invalid_description`,
`invalid_url`, `invalid_image`, `wrong_dimensions`, `logo_required`,
`asset_not_found`, `not_owner`, `bad_signature`, `challenge_required`,
`challenge_expired`, `too_soon`, `node_unreachable`, `node_error`,
`catalog_error`, `missing_param`, `not_found`, `unprocessable`.

A successful publish (or update) of an asset starts a rolling 24-hour
window: the next `POST /api/submit` for that same hash returns `429 too_soon`
until the window elapses. The one-time challenge already blocks replay of a
single signed request; the window stops a creator from flooding the catalog
with a fresh challenge each time. Override with `RESUBMIT_INTERVAL_SECONDS`
on the backend.

The server re-validates everything the browser checked — never trust the client.

### `GET /api/auth/challenge?asset_hash=<hash>`

Returns `{ ok: true, data: { message, nonce, expiresIn } }`. The message is
bound to the host and the asset, so a signature cannot be replayed against
another token.

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
