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
                       ──── GET  /assets/<hash>/... ──►  serve metadata
  autocomplete         ──── GET  /asset/complete ─────►  Warthog node (direct)
```

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

The public catalog. Open CORS so wallets and explorers can read it.

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
