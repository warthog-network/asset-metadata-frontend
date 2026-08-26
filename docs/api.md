# Asset Metadata API

Programmatic reference for the asset-metadata submission service. Every
path below is reachable on the live site at
`https://testnet-assets.warthog.network/...`. Netlify 200-rewrites the
URLs to the Phoenix backend, so they're same-origin in production and
CORS is irrelevant from the frontend origin. Two conventions coexist:
`/api/*` uses an `{ ok, data | error }` envelope, the public catalog
returns the resource itself (binary files can't carry an envelope).
Detailed request/response shapes and the envelope error codes live in
the README under **Backend contract**.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | [`/api/submit`](https://testnet-assets.warthog.network/api/submit) | Submit metadata for an existing asset. Multipart form, see body + auth below. |
| GET  | [`/api/auth/challenge?asset_hash=<hash>`](https://testnet-assets.warthog.network/api/auth/challenge?asset_hash=0000000000000000000000000000000000000000000000000000000000000000) | Get a one-time challenge nonce, bound to the host and the asset hash. |
| GET  | [`/assets.json`](https://testnet-assets.warthog.network/assets.json) | Full catalog list. |
| GET  | [`/assets/<hash>/info.json`](https://testnet-assets.warthog.network/assets/0000000000000000000000000000000000000000000000000000000000000000/info.json) | Single asset metadata document. |
| GET  | [`/assets/<hash>/logo.png`](https://testnet-assets.warthog.network/assets/0000000000000000000000000000000000000000000000000000000000000000/logo.png) | Asset logo, exactly 250×250 PNG. |
| GET  | [`/assets/<hash>/image.png`](https://testnet-assets.warthog.network/assets/0000000000000000000000000000000000000000000000000000000000000000/image.png) | Same as `logo.png` (alias). |
| GET  | [`/assets/<hash>/banner.png`](https://testnet-assets.warthog.network/assets/0000000000000000000000000000000000000000000000000000000000000000/banner.png) | Asset banner, exactly 600×200 PNG. |

## Programmatic submission flow

Submission is wallet-authenticated — only the asset's on-chain creator
can publish its metadata. Anyone else gets `403 not_owner`.

1. **GET the challenge.**

   ```
   GET /api/auth/challenge?asset_hash=<64-hex-asset-hash>
   ```

   Response: `{ ok: true, data: { message, nonce, expiresIn } }`. The
   `message` is bound to this host and this asset, so the signature
   cannot be replayed against another token.

2. **Sign the message.** `message` is a UTF-8 string. Sign it with the
   secp256k1 private key of the asset's on-chain creator and hex-encode
   the result as a 130-char lowercase string (`r || s || recid`). The
   signature scheme (SHA-256 digest, RFC 6979 deterministic `k`,
   BIP-62 low-s normalization, recovery byte) is documented in
   [Wallet Integration](https://docs.warthog.network/developers/integration/wallets)
   with low-level code for Python, Node JS, and Elixir. The three
   official SDKs wrap this in one call:

   - [`warthog-ts`](https://www.npmjs.com/package/warthog-ts) —
     `account.signBytes(message).signature`
   - [`warthog_ex`](https://github.com/warthog-network/warthog_ex) —
     `WarthogEx.Account.sign_bytes(account, message)` (4th tuple element)
   - [`warthog_py`](https://github.com/warthog-network/warthog_py) —
     `account.sign_bytes(message)` (4th tuple element)

3. **POST the form.** See body table below.

## `POST /api/submit` body

`multipart/form-data`. Response: `201 { ok: true, data: { assetHash, infoUrl, logoUrl, bannerUrl } }` or `4xx/5xx { ok: false, error: { code, message } }`. Full error codes live in the README under **Backend contract**.

| Field | Required | Type | Notes |
|---|---|---|---|
| `asset_hash`        | yes | 64 hex chars                       | Must exist on chain |
| `name`              | yes | string ≤ 15 chars | Human-readable long name |
| `description`       | yes | string ≤ 500 chars                 | |
| `logo`              | yes | PNG or JPEG, exactly 250×250 px    | Re-encoded client-side in the form |
| `wallet_nonce`      | yes | string                             | From step 1 |
| `wallet_signature`  | yes | 130 hex chars                      | From step 2 |
| `banner`            | no  | PNG or JPEG, exactly 600×200 px    | Re-encoded client-side in the form |
| `website`           | no  | `https://` URL ≤ 2048 chars        | |
| `telegram`         | no  | `https://` URL ≤ 2048 chars        | |
| `discord`          | no  | `https://` URL ≤ 2048 chars        | |
| `twitter`          | no  | `https://` URL ≤ 2048 chars        | |

URL fields must start with `https://` — mixed-content warnings would
otherwise break rendering on the public catalog.

## Quick example (curl)

```sh
# 1. Fetch the challenge (substitute the real asset hash).
curl -sS "https://testnet-assets.warthog.network/api/auth/challenge?asset_hash=<HASH>"

# 2. Sign the returned `message` with the asset creator's secp256k1 key,
#    producing a 130-hex-char `wallet_signature`.

# 3. POST the multipart form.
curl -sS -X POST https://testnet-assets.warthog.network/api/submit \
  -F "asset_hash=<HASH>" \
  -F "name=Token Long Name" \
  -F "description=..." \
  -F "logo=@logo.png;type=image/png" \
  -F "wallet_nonce=<NONCE>" \
  -F "wallet_signature=<SIG>"
```

`<hash>` is the 64-hex asset hash. Example URLs above use the
all-zero placeholder hash `0000…0000` so you can click through and
see the 404 shape; substitute a real hash for an actual asset. The
same files are also reachable at `/<hash>/…` (no `/assets` prefix)
on every domain the site serves — see the README's **Deploy**
section for why that root-hash shape exists and why `info.json`,
`logo.png`, `image.png`, `banner.png` are reserved sitewide.