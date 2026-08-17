// GET /api/node-health — probes each Warthog testnet node for liveness.
// Returns {nodes: [{url, name, alive, version?, latency_ms?, error?, checked_at}]}.
// Cached for 30 seconds to avoid hammering the nodes on rapid browser polls.

interface NodeEntry {
  url: string;
  name: string;
}

export interface HealthInfo extends NodeEntry {
  alive: boolean;
  version?: string;
  latency_ms?: number;
  error?: string;
  checked_at: string;
}

interface CacheEntry {
  results: HealthInfo[];
  ts: number;
}

// TODO: when testnet nodes expose a dedicated `GET /version` endpoint
// (small payload, purpose-built for liveness probes), switch probeOne
// from `GET /` to `GET /version`. Same HealthInfo shape. Tracked in
// README under "Roadmap".
async function probeOne(node: NodeEntry, timeout_ms = 5_000): Promise<HealthInfo> {
  const start = Date.now();
  try {
    // Use Promise.race instead of AbortSignal because setTimeout / AbortController
    // appear to fire immediately inside this Bun.serve fetch handler context.
    // The race approach is robust: whichever settles first wins.
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${timeout_ms}ms`)), timeout_ms);
    });

    const fetchPromise = fetch(node.url, {
      headers: { Accept: "text/html,application/json,*/*" },
      redirect: "follow",
    }).then(async (res) => {
      if (!res.ok) {
        return {
          url: node.url,
          name: node.name,
          alive: false as const,
          latency_ms: Date.now() - start,
          error: `HTTP ${res.status}`,
          checked_at: new Date().toISOString(),
        };
      }
      const text = await res.text();
      const versionMatch = text.match(/v\d+\.\d+\.\d+/);
      return {
        url: node.url,
        name: node.name,
        alive: true as const,
        version: versionMatch ? versionMatch[0] : "unknown",
        latency_ms: Date.now() - start,
        checked_at: new Date().toISOString(),
      };
    });

    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (err) {
    const msg = (err as Error).message ?? "fetch failed";
    const timedOut = msg.startsWith("timed out");
    return {
      url: node.url,
      name: node.name,
      alive: false as const,
      latency_ms: Date.now() - start,
      error: timedOut ? msg : msg,
      checked_at: new Date().toISOString(),
    };
  }
}

let cache: CacheEntry | null = null;
const HEALTH_CACHE_TTL_MS = 30_000;
const PUBLIC_DATA_NODES_URL = "https://data.warthog.network/defi-nodes.json";
const HARDCODED_FALLBACK: NodeEntry[] = [
  { url: "https://warthog-defitestnet.duckdns.org/", name: "Official 2" },
];

async function loadNodeList(): Promise<NodeEntry[]> {
  try {
    const res = await fetch(PUBLIC_DATA_NODES_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (Array.isArray(body?.nodes) && body.nodes.length > 0) return body.nodes;
    throw new Error("empty nodes array");
  } catch {
    return HARDCODED_FALLBACK;
  }
}

export async function handleNodeHealth(_req: Request): Promise<Response> {
  const now = Date.now();
  if (cache && now - cache.ts < HEALTH_CACHE_TTL_MS) {
    return Response.json({ nodes: cache.results, cached: true });
  }

  const nodeList = await loadNodeList();
  const results = await Promise.all(nodeList.map(probeOne));
  cache = { results, ts: now };
  return Response.json({ nodes: results, cached: false });
}
