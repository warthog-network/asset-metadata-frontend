// Typed error hierarchy. Mirrors the Elixir `SubmissionError` tuples so
// the same error messages surface in the same JSON shape.

import { env } from "./env";

// Discriminated union — every error variant is explicit. The handler
// in `src/handlers/submit.ts` doesn't need to know about any of these
// types directly; it just calls `humanize(err)` and `statusFor(err)`.
export type SubmissionError =
  | { kind: "invalid_hash"; msg: string }
  | { kind: "invalid_name"; msg: string }
  | { kind: "invalid_description"; msg: string }
  | { kind: "invalid_url"; field: string; msg: string }
  | { kind: "logo_required" }
  | { kind: "invalid_image"; field: "logo" | "banner"; msg: string }
  | { kind: "wrong_dimensions"; field: "logo" | "banner"; msg: string }
  | { kind: "asset_not_found" }
  | { kind: "node_unreachable" }
  | { kind: "github"; status: number; body: unknown };

export class SubmissionValidationError extends Error {
  constructor(public readonly err: SubmissionError) {
    super(`submission: ${err.kind}`);
    this.name = "SubmissionValidationError";
  }
}

// 422 on the catch-all is intentional: the request was syntactically valid
// but the input failed semantic validation. 502 for GitHub-side failures
// (since we couldn't reach the upstream). 503 for node-unreachable.
export function statusFor(err: SubmissionError): number {
  switch (err.kind) {
    case "invalid_hash":
    case "invalid_name":
    case "invalid_description":
    case "invalid_url":
    case "invalid_image":
    case "wrong_dimensions":
    case "logo_required":
    case "asset_not_found":
      return 400;
    case "node_unreachable":
      return 503;
    case "github":
      return err.status >= 400 && err.status < 600 ? err.status : 502;
  }
}

// Match the Elixir humanize/1: surface the field name + the specific
// reason for that variant. For GitHub errors, prefer the first nested
// `errors[].message` over the generic top-level `message` ("Validation
// Failed"), which carries the specific reason ("A pull request already
// exists for ...").
export function humanize(err: SubmissionError): string {
  switch (err.kind) {
    case "invalid_hash":
      return "asset hash must be 64 hex chars";
    case "invalid_name":
      return "long name is required and must be at most 15 characters";
    case "invalid_description":
      return "description is required and must be at most 500 characters";
    case "invalid_url":
      return `${err.field} ${err.msg}`;
    case "invalid_image":
      return `${err.field}: ${err.msg}`;
    case "wrong_dimensions":
      return `${err.field}: ${err.msg}`;
    case "logo_required":
      return "logo file is required";
    case "asset_not_found":
      return "asset does not exist on chain — only existing assets can be aggregated with metadata";
    case "node_unreachable":
      return "testnet node is unreachable";
    case "github":
      return `GitHub ${err.status}: ${extractGitHubMessage(err.body)}`;
  }
}

function extractGitHubMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const msg = (body as { message: unknown }).message;
    if (msg === "Validation Failed" && Array.isArray((body as { errors?: unknown }).errors)) {
      const errors = (body as { errors: Array<{ message?: string }> }).errors;
      const first = errors[0];
      if (first?.message) return first.message;
    }
    if (typeof msg === "string") return msg;
  }
  return "unknown error";
}

export function isSubmissionError(err: unknown): err is SubmissionError {
  return err instanceof Error && "kind" in err;
}

// Type guards for narrowing in callers.
export function asSubmissionError(err: unknown): SubmissionError | null {
  if (isSubmissionError(err)) return err;
  return null;
}

// Unused but kept for future API surface.
export const _env = env;
