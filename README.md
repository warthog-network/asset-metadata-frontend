# Warthog Asset Metadata

Self-hosted service that accepts token-metadata submissions for a Warthog asset and opens a pull request against [`warthog-network/public-data`](https://github.com/warthog-network/public-data).

The service hosts the form at its base URL and exposes a JSON API at `/api/submit` for programmatic callers. Browser form submits validate that the asset exists on chain, extract the `ticker` from the node's `AssetName`, and open a PR.

No database. No framework. No compile step in dev. Zero runtime dependencies — Bun provides fetch, FormData, file I/O, and the test runner.

## Endpoints

### `GET /`

Renders the Warthog-branded submission form. The browser posts the form via `fetch()` to `/api/submit`; success replaces the form with a summary panel, error shows a banner inline.

### `POST /api/submit`

JSON-only endpoint. Accepts `multipart/form-data` and always returns JSON.

| Field | Required | Type | Notes |
|---|---|---|---|
| `asset_hash` | yes | 64 hex chars | Must exist on chain |
| `name` | yes | string ≤ 15 chars | Long name |
| `description` | yes | string ≤ 500 chars | |
| `website` | no | `https://` URL ≤ 2048 chars | |
| `telegram` | no | `https://` URL ≤ 2048 chars | |
| `discord` | no | `https://` URL ≤ 2048 chars | |
| `twitter` | no | `https://` URL ≤ 2048 chars | |
| `logo` | yes | image/png or image/jpeg, exactly 250×250 px | Auto-resized client-side if bigger; server validates dimensions |
| `banner` | no | image/png or image/jpeg, exactly 600×200 px | |

**Body size limit:** 2 MB (Bun returns 413 automatically).

The browser validates image dimensions **before upload** via `assets/js/submit.js` (uses `<canvas>` + `Image().decode()` for dimensions, `canvas.toBlob('image/png')` for resize + format conversion). The server re-validates from the PNG/JPEG header bytes — **never trust the client**.

The browser sets `Accept: application/json` via `fetch()`; cross-origin callers must set it explicitly.

Success (HTTP 201):
```json
{
  "ok": true,
  "prUrl": "https://github.com/warthog-network/public-data/pull/123",
  "assetHash": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

Error (HTTP 4xx/5xx):
```json
{ "ok": false, "error": "logo: must be exactly 250x250 px, got 300x300 px" }
```

### `GET /api/complete?prefix=<hash>`

Best-effort autocomplete proxy to the testnet node. Returns `{ "matches": [...] }`. Never returns an error — autocomplete is best-effort, so the UI just sees an empty list on failure.

## Configuration

Read in `src/env.ts`. Every module imports `env` rather than re-reading `process.env` directly.

| Env var | Required | Default | Notes |
|---|---|---|---|
| `GITHUB_TOKEN` | yes (prod) | — | Classic PAT or GitHub App installation token with `repo` scope. Service refuses to boot in prod if missing. |
| `TESTNET_NODE_URL` | no | `https://warthog-defitestnet.duckdns.org/` | Used for `GET /asset/lookup/{hash}` and `GET /asset/complete`. |
| `GITHUB_REPO` | no | `warthog-network/public-data` | Target repo for PRs. |
| `GITHUB_BASE_BRANCH` | no | `master` | The branch PRs target. |
| `PORT` | no | `4000` | HTTP port. |
| `ENDPOINT_BASE_URL` | unused | — | Reserved for future use. |
| `CORS_ORIGIN` | unused | — | Reserved for future use. |

## Run locally

```sh
bun install
bun run dev
```

Open `http://localhost:4000`. Without `GITHUB_TOKEN`, the form's `POST /api/submit` will fail at the GitHub step with a clear error.

## Deploy

Single process. Runs anywhere Bun 1.x runs:

- Dockerfile (multi-stage: install deps → copy `src/` + `public/` → run `bun src/server.ts`)
- systemd unit
- fly.io / Railway / Render
- Behind a TLS-terminating reverse proxy

```sh
GITHUB_TOKEN=ghp_xxx bun src/server.ts
```

## Field reference

| Field | Required | Type | Server limit | Why this limit |
|---|---|---|---|---|
| `asset_hash` | yes | 64 hex chars | 64 chars | SHA3-256 hex. |
| `name` | yes | string | 1–15 chars | Human-readable long name. |
| `description` | yes | string | 1–500 chars | Enough for two paragraphs of project context. |
| `website` / `telegram` / `discord` / `twitter` | no | `https://` URL | ≤ 2048 chars | The de-facto URL length cap across browsers and proxies. |
| `logo` | yes | PNG or JPEG | ≤ 2 MB body | Exactly 250×250 px after normalization. |
| `banner` | no | PNG or JPEG | ≤ 2 MB body | Exactly 600×200 px after normalization. |

**URL prefix rule.** All four URL fields must start with `https://` (not `http://`, not protocol-relative). HTTP-only links are rejected because the metadata ends up in a public repo.

**Where these limits live in code:**
- HTML `maxlength`: `src/handlers/home.ts` (rendered inline in the form).
- Server-side limits: `src/lib/submission.ts` (`MAX_NAME_LENGTH`, `MAX_DESCRIPTION_LENGTH`, `MAX_URL_LENGTH`).

## GitHub call strategy

The submission walks a strict dependency graph of GitHub's data model — each step's response is needed by the next. Any failure short-circuits the chain and surfaces GitHub's actual `message` to the browser (so the operator sees e.g. `GitHub: Resource not accessible by personal access token` instead of a generic "check server logs").

| # | Call | Function | Purpose |
|---|---|---|---|
| 1 | `node GET /asset/lookup/<hash>` | `Node.lookup()` | Verify the asset exists on chain; extract the `ticker` (`AssetName`). |
| 2 | `github GET /repos/.../git/ref/heads/master` | `GitHub.branchSha("master")` | Get master HEAD SHA — the commit we fork the per-asset branch from. |
| 3 | `github GET /repos/.../git/refs?per_page=100&page=N` | `GitHub.findExistingBranch()` | Paginated walk through all refs; check if `asset-metadata/<hash-prefix>` already exists. |
| 4 | `github POST /repos/.../git/refs` | `GitHub.ensureBranch()` (create branch) | Create the per-asset branch pointing at the master SHA from #2. Only fires if #3 didn't find the branch. |
| 5 | `github GET /repos/.../git/ref/heads/<branch>` | `GitHub.branchSha(branch)` | Get the per-asset branch HEAD SHA — used as the `parent_sha` for the commit. |
| 6 | `github POST /repos/.../git/blobs` | `GitHub.createBlob()` | Upload each binary file (logo, banner) base64-encoded, get back blob SHAs. Binary content can't go inline in a tree because JSON encoding fails on binary bytes. |
| 7 | `github POST /repos/.../git/trees` | `GitHub.commitFiles()` (tree) | Create the tree object. Text content goes inline (`info.json`); binary content references the blob SHAs from #6. `base_tree: <parent_sha>` inherits the existing branch's other files. |
| 8 | `github POST /repos/.../git/commits` | `GitHub.commitFiles()` (commit) | Create the commit object pointing at the new tree, with parent = branch HEAD and the human-readable commit message. |
| 9 | `github POST /repos/.../git/refs/heads/<branch>` | `GitHub.commitFiles()` (update ref) | Move the per-asset branch forward to the new commit. Without this the commit is orphaned. |
| 10 | `github GET /repos/.../pulls?state=all&per_page=100&page=N` | `GitHub.findExistingPr()` | Paginated walk looking for an existing PR. Tries `state: "all"` first so merged/closed PRs are found for re-submissions. |
| 11 | `github GET /repos/.../pulls?state=open&per_page=100&page=N` | `GitHub.findExistingPr()` (fallback) | If #10 missed, try `state: "open"`. |
| 12 | `github POST /repos/.../pulls` | `GitHub.openPr()` | Open the PR. Title: `Add token metadata: <ticker> (<short-hash>)`. Body includes the on-chain `ticker`, the short hash, and the directory path the maintainer will see after merge. |

**Idempotency.** The branch creation (#3 + #4), the find-existing-PR check (#10 + #11), and the blob upload (#6) all make the whole flow safe to call twice for the same asset. The second call updates the existing branch in place, finds the existing PR, and returns its URL instead of opening a duplicate.

**422 race-recovery.** When GitHub returns 422 from POST /pulls (which happens when there's an existing PR we didn't find), `GitHub.openPr()` catches it and calls `findExistingPr()` again. If the second call succeeds, the existing PR URL is returned. If both miss, the original 422 is re-thrown so the user sees GitHub's actual message.

**What gets surfaced on failure.** GitHub's `message` field is unwrapped from `{:api, status, body}` in `src/errors.ts` and shown to the user verbatim. For 422 responses, the first nested `errors[].message` is preferred over the generic top-level `message` ("Validation Failed"), which carries the specific reason ("A pull request already exists for X", "No commits between master and feature", etc.). The same text also gets written to the server log so an ops engineer can correlate.

## Architecture

```
asset-metadata-js/
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts              # Bun.serve + safeHandle() per-request try/catch
│   ├── env.ts                 # single source of truth for env vars
│   ├── errors.ts              # typed SubmissionError union + statusFor + humanize
│   ├── handlers/
│   │   ├── home.ts            # GET /  →  render index.html
│   │   ├── submit.ts          # POST /api/submit  →  submission.submit()
│   │   └── complete.ts        # GET /api/complete  →  node.complete()
│   └── lib/
│       ├── node.ts            # testnet node client
│       ├── github.ts          # 12-call GitHub API client (with 422 recovery)
│       ├── images.ts          # PNG/JPEG header parser (~30 LoC, no sharp)
│       └── submission.ts      # orchestrator (never throws, always Result)
├── public/
│   ├── index.html             # rendered server-side from src/handlers/home.ts
│   ├── js/{app,submit,autocomplete}.js
│   ├── css/app.css
│   └── images/warthog-mark.svg
└── test/
    ├── env.test.ts
    ├── images.test.ts
    └── github-flow.test.ts
```

## Error containment

Three layers ensure the service **never crashes** from a single bad request:

| Layer | Where | Catches | What happens |
|---|---|---|---|
| **Per-call** | `src/lib/{node,github,images}.ts` | Network failures, non-2xx responses, malformed JSON, schema mismatches | Throws typed error. Logs at `console.warn` (4xx) or `console.error` (transport/JSON). |
| **Per-handler** | `src/handlers/submit.ts` | Malformed FormData | Logs `console.warn`, returns 400 JSON. |
| **Per-request** | `src/server.ts` `safeHandle()` | ANY uncaught exception | Logs full stack with timestamp + method + path. Returns generic 500. **Service keeps running.** |

Plus `maxRequestBodySize: 2 MB` — Bun returns 413 automatically for oversized uploads.

Plus `AbortSignal.timeout(10_000)` on every external HTTP call — 10s for both testnet node and GitHub.

Plus `complete()` returns `[]` on failure — autocomplete is best-effort, never breaks the form.

## Tests

```sh
bun test
```

Hand-picked, not ported from the Elixir version. Three test files:

| File | What it covers |
|---|---|
| `test/env.test.ts` | Env-var defaults and prod guard |
| `test/images.test.ts` | PNG/JPEG header parsing edge cases + dimension validation |
| `test/github-flow.test.ts` | 11-step GitHub chain with mocked fetch, including 422 race-recovery and various error paths |

## Branding

Per the Warthog brand kit (V01.A, 2023·2024, by BalkyBot):

- Logo: `Circle Negative Yellow.svg` (white circle with yellow warthog) → `public/images/warthog-mark.svg`
- Font: Montserrat via Google Fonts CDN
- Primary yellow: `#FDB913` (used for accents, focus rings, button gradient start)
- Orange: `#E79300` (button gradient end)
- Button gradient: `from-[#FDB913] to-[#E79300]` (one of the three approved gradients)
- Background: radial `#111b2e → #020617 45% → #000308 85%`
- Form card: `rgba(8, 12, 24, 0.75)` + `border rgba(255, 255, 255, 0.1)`
- Text primary: `#f8fafc`; muted: `rgba(226, 232, 240, 0.75)`

## Roadmap

- **Node `/version` endpoint.** When Warthog testnet nodes expose a dedicated
  `GET /version` endpoint (small payload, purpose-built for liveness
  probes), `src/handlers/node-health.ts` will switch its `probeOne`
  function from fetching `GET /` to fetching `GET /version`. The
  `HealthInfo` shape stays the same. Tracked inline in
  `src/handlers/node-health.ts` as a TODO comment near `probeOne`.

## License

Same as the rest of the hub: MIT.
