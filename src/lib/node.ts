// Testnet node client. Talks to the Warthog defi node's HTTP API:
//   GET /asset/lookup/{hash}    → verify asset exists, get ticker
//   GET /asset/complete?hashPrefix=...  → autocomplete
//
// Mirrors the Elixir AssetMetadataService.Node module.

import { env } from "../env";

export class NodeError extends Error {
  constructor(
    public readonly kind: "timeout" | "unreachable" | "unparseable",
    msg: string,
  ) {
    super(`node: ${kind}: ${msg}`);
    this.name = "NodeError";
  }
}

const TIMEOUT_MS = 10_000;

function url(path: string): string {
  return `${env.testnetNodeUrl.replace(/\/$/, "")}${path}`;
}

export async function lookup(assetHash: string): Promise<{ name: string; decimals: number }> {
  const u = url(`/asset/lookup/${assetHash}`);
  console.log(`node GET ${u}`);

  let res: Response;
  try {
    res = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    console.warn(`node GET ${u} transport error:`, err);
    if ((err as { name?: string }).name === "TimeoutError") {
      throw new NodeError("timeout", `lookup exceeded ${TIMEOUT_MS / 1000}s`);
    }
    throw new NodeError("unreachable", (err as Error).message ?? "unknown");
  }

  if (!res.ok) {
    console.warn(`node GET ${u} failed: HTTP ${res.status}`);
    throw new NodeError("unreachable", `HTTP ${res.status}`);
  }

  let body: { code?: unknown; data?: { name?: unknown; decimals?: unknown } } | null = null;
  try {
    body = await res.json();
  } catch (err) {
    console.error(`node GET ${u} response not JSON:`, err);
    throw new NodeError("unparseable", "response was not valid JSON");
  }

  if (body?.code !== 0 || !body?.data?.name || typeof body.data.name !== "string") {
    console.warn(
      `node GET ${u} unexpected shape:`,
      JSON.stringify(body).slice(0, 500),
    );
    throw new NodeError("unparseable", "response missing data.name");
  }

  return {
    name: body.data.name,
    decimals: typeof body.data.decimals === "number" ? body.data.decimals : 0,
  };
}

// Autocomplete is best-effort — never throws, never crashes the form.
// Just logs the failure and returns an empty matches list.
export async function complete(prefix: string): Promise<unknown[]> {
  const u = url(`/asset/complete?hashPrefix=${encodeURIComponent(prefix)}`);
  console.log(`node GET ${u}`);

  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`node GET ${u} failed: HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    const matches = (body as { data?: { matches?: unknown } } | null)?.data?.matches;
    return Array.isArray(matches) ? matches : [];
  } catch (err) {
    console.warn(`node GET ${u} failed:`, err);
    return [];
  }
}
