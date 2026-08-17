// Submission orchestrator. Mirrors the Elixir `Submission.submit/2`
// flow but written as straight-line async code instead of `with` chains.
//
// KEY INVARIANT: `submit()` NEVER throws. Every error path returns a
// typed Result object. The HTTP handler just translates to JSON. This
// keeps the `safeHandle` defense-in-depth in `server.ts` from ever
// having to catch a thrown error from this module.

import { env } from "../env";
import { GitHub, GitHubError } from "./github";
import * as Node from "./node";
import {
  EXPECTED_LOGO_SIZE,
  EXPECTED_BANNER_SIZE,
  ImageError,
  validateDimensions,
} from "./images";
import {
  SubmissionError,
  SubmissionValidationError,
  humanize,
  statusFor,
} from "../errors";

const HASH_REGEX = /^[0-9a-fA-F]{64}$/;
const MAX_NAME_LENGTH = 15;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_URL_LENGTH = 2048;

export interface SubmitInput {
  asset_hash: string;
  name: string;
  description: string;
  website: string;
  telegram: string;
  discord: string;
  twitter: string;
  logo: File | null;
  banner: File | null;
}

export type SubmitResult =
  | { ok: true; prUrl: string; assetHash: string }
  | { ok: false; error: string; status: number };

export async function submit(input: SubmitInput): Promise<SubmitResult> {
  try {
    const attrs = validateAttrs(input);
    const uploads = await validateUploads(input);
    const ticker = await lookupTicker(attrs.asset_hash);
    const prUrl = await openPr(attrs, ticker, uploads);
    return { ok: true, prUrl, assetHash: attrs.asset_hash };
  } catch (err) {
    if (err instanceof SubmissionValidationError) {
      const submissionErr = err.err;
      console.warn(
        `submission failed: ${submissionErr.kind}: ${"msg" in submissionErr ? submissionErr.msg : ""}`,
      );
      return { ok: false, error: humanize(submissionErr), status: statusFor(submissionErr) };
    }
    console.error("submission unexpected error:", err);
    return { ok: false, error: "internal server error", status: 500 };
  }
}

function validateAttrs(input: SubmitInput) {
  const { asset_hash } = input;
  if (!asset_hash || !HASH_REGEX.test(asset_hash)) {
    throw new SubmissionValidationError({
      kind: "invalid_hash",
      msg: "asset_hash must be 64 hex chars",
    });
  }

  const { name } = input;
  if (!name || name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new SubmissionValidationError({
      kind: "invalid_name",
      msg: `long name is required and must be at most ${MAX_NAME_LENGTH} characters`,
    });
  }

  const { description } = input;
  if (!description || description.length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new SubmissionValidationError({
      kind: "invalid_description",
      msg: `description is required and must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    });
  }

  for (const field of ["website", "telegram", "discord", "twitter"] as const) {
    validateUrl(input[field], field);
  }

  return {
    asset_hash,
    name,
    description,
    website: input.website,
    telegram: input.telegram,
    discord: input.discord,
    twitter: input.twitter,
  };
}

function validateUrl(value: string, field: string): void {
  const trimmed = value.trim();
  if (trimmed === "") return; // optional

  if (!trimmed.startsWith("https://")) {
    throw new SubmissionValidationError({
      kind: "invalid_url",
      field,
      msg: "must start with https://",
    });
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    throw new SubmissionValidationError({
      kind: "invalid_url",
      field,
      msg: `must be ${MAX_URL_LENGTH} characters or fewer (got ${trimmed.length})`,
    });
  }

  // The Elixir version checked basic URL syntax here too. We trust the
  // browser to enforce that; the server only validates the length prefix.
}

async function validateUploads(input: SubmitInput): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();

  if (!input.logo) {
    throw new SubmissionValidationError({ kind: "logo_required" });
  }

  const logoBytes = new Uint8Array(await input.logo.arrayBuffer());
  try {
    validateDimensions(logoBytes, EXPECTED_LOGO_SIZE, "logo");
  } catch (err) {
    if (err instanceof ImageError) {
      throw new SubmissionValidationError({ kind: err.reason, field: "logo", msg: err.message });
    }
    throw err;
  }
  out.set("logo.png", logoBytes);

  if (input.banner) {
    const bannerBytes = new Uint8Array(await input.banner.arrayBuffer());
    try {
      validateDimensions(bannerBytes, EXPECTED_BANNER_SIZE, "banner");
    } catch (err) {
      if (err instanceof ImageError) {
        throw new SubmissionValidationError({ kind: err.reason, field: "banner", msg: err.message });
      }
      throw err;
    }
    out.set("banner.png", bannerBytes);
  }

  return out;
}

async function lookupTicker(assetHash: string): Promise<string> {
  try {
    const { name } = await Node.lookup(assetHash);
    return name;
  } catch (err) {
    if (err instanceof Node.NodeError) {
      const kind: SubmissionError["kind"] =
        err.kind === "timeout" || err.kind === "unreachable" ? "node_unreachable" : "node_unreachable";
      void kind;
      throw new SubmissionValidationError({ kind: "node_unreachable" });
    }
    // Shouldn't happen, but if Node.lookup throws something else, surface
    // it as node_unreachable so the user sees something.
    console.error("lookupTicker unexpected:", err);
    throw new SubmissionValidationError({ kind: "node_unreachable" });
  }
}

async function openPr(
  attrs: {
    asset_hash: string;
    name: string;
    description: string;
    website: string;
    telegram: string;
    discord: string;
    twitter: string;
  },
  ticker: string,
  uploads: Map<string, Uint8Array>,
): Promise<string> {
  const branch = `asset-metadata/${attrs.asset_hash.slice(0, 12)}`;
  const short = shortHash(attrs.asset_hash);
  const gh = new GitHub();

  // 1. Get master SHA
  const masterSha = await gh.branchSha(env.githubBaseBranch);

  // 2. Ensure per-asset branch exists
  await gh.ensureBranch(branch, masterSha);

  // 3. Get branch HEAD SHA (needed as parent_sha for the commit)
  const parentSha = await gh.branchSha(branch);

  // 4. Build info.json + commits the files
  const infoJson = JSON.stringify({
    hash: attrs.asset_hash,
    ticker,
    name: attrs.name,
    description: attrs.description,
    website: attrs.website,
    telegram: attrs.telegram,
    discord: attrs.discord,
    twitter: attrs.twitter,
  }, null, 2);

  const files = new Map<string, Uint8Array>();
  files.set("info.json", new TextEncoder().encode(infoJson));
  for (const [path, content] of uploads) {
    files.set(path, content);
  }
  // Files land under `data/assets/<hash>/` (community spec path).
  const filesWithPath = prefixPaths(files, attrs.asset_hash);

  await gh.commitFiles(branch, "Add token metadata via Warthog Asset Metadata", filesWithPath, parentSha);

  // 5. Open the PR (with 422 race-recovery in github.openPr)
  const title = `Add token metadata: ${ticker} (${short})`;
  const body = prBodyTemplate(attrs.asset_hash, ticker, short);
  const prUrl = await gh.openPr(branch, title, body);

  // If openPr succeeded but the URL is a known race-condition atom, treat
  // it as a real PR URL (the recovery path returns the existing URL).
  if (!prUrl || prUrl === "") {
    console.error("openPr returned empty url");
    throw new SubmissionValidationError({ kind: "github", status: 500, body: "empty url" });
  }

  return prUrl;
}

function prefixPaths(files: Map<string, Uint8Array>, assetHash: string): Map<string, Uint8Array> {
  const base = `data/assets/${assetHash}/`;
  const out = new Map<string, Uint8Array>();
  for (const [path, content] of files) {
    out.set(base + path, content);
  }
  return out;
}

function shortHash(assetHash: string): string {
  const prefix = assetHash.slice(0, 4);
  const suffix = assetHash.slice(-4);
  return `${prefix}...${suffix}`;
}

function prBodyTemplate(assetHash: string, ticker: string, short: string): string {
  // Keep this reviewer-friendly. No TODOs / internal notes go here.
  return [
    `Add token metadata for asset ticker \`${ticker}\` (hash \`${short}\`).`,
    "",
    "Submitted via [Warthog Asset Metadata](https://github.com/warthog-network/asset-metadata-js).",
    "The `ticker` field is taken from the on-chain `AssetName` returned by the",
    "defi node's `GET /asset/lookup/{hash}` endpoint.",
    "",
    "Please review the field values below. The directory path will be",
    `\`data/assets/${assetHash}/\` once this PR merges.`,
    "",
    "@warthog-asset-metadata[bot]",
    "",
  ].join("\n");
}
