// Browser-side testnet node helper:
//   - Fetch the DeFi node list from data.warthog.network (with hardcoded fallback)
//   - Fetch per-node health (alive/version) from the asset-metadata-js /api/node-health
//   - Cache both in sessionStorage with TTL
//   - Persist the user's chosen URL in localStorage
//   - Provide a render helper for the dropdown popover

const PUBLIC_DATA_BASE = "https://data.warthog.network";
const NODES_URL = `${PUBLIC_DATA_BASE}/defi-nodes.json`;
const NODES_CACHE_KEY = "warthog:defi-nodes";
const NODES_CACHE_TTL_MS = 10 * 60 * 1000;
const SELECTION_KEY = "warthog:selected-node-url";
const HARDCODED_FALLBACK: NodeEntry[] = [
  { url: "https://warthog-defitestnet.duckdns.org/", name: "Official 2" },
];

export interface NodeEntry {
  url: string;
  name: string;
}

export interface NodeWithHealth extends NodeEntry {
  alive?: boolean;
  version?: string;
  latency_ms?: number;
}

interface NodesCache {
  entries: NodeEntry[];
  ts: number;
}

let nodesCache: NodesCache | null = null;
let nodesInflight: Promise<NodeEntry[]> | null = null;

function loadNodesCache(): NodesCache | null {
  try {
    const raw = sessionStorage.getItem(NODES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NodesCache;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveNodesCache(entries: NodeEntry[]): void {
  try {
    sessionStorage.setItem(
      NODES_CACHE_KEY,
      JSON.stringify({ entries, ts: Date.now() }),
    );
  } catch {
    /* sessionStorage may be unavailable */
  }
}

export async function loadNodes(force = false): Promise<NodeEntry[]> {
  if (!force && nodesCache && Date.now() - nodesCache.ts < NODES_CACHE_TTL_MS) {
    return nodesCache.entries;
  }
  if (!force && nodesInflight) return nodesInflight;

  nodesInflight = (async () => {
    try {
      const res = await fetch(NODES_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const entries: NodeEntry[] = Array.isArray(body?.nodes)
        ? (body.nodes as unknown[]).filter(
            (n): n is NodeEntry =>
              typeof n === "object" &&
              n !== null &&
              typeof (n as NodeEntry).url === "string" &&
              typeof (n as NodeEntry).name === "string",
          )
        : [];
      const final = entries.length > 0 ? entries : HARDCODED_FALLBACK;
      nodesCache = { entries: final, ts: Date.now() };
      saveNodesCache(nodesCache.entries);
      return nodesCache.entries;
    } catch {
      nodesCache = { entries: HARDCODED_FALLBACK, ts: Date.now() };
      return HARDCODED_FALLBACK;
    } finally {
      nodesInflight = null;
    }
  })();

  return nodesInflight;
}

interface HealthCache {
  byUrl: Map<string, NodeWithHealth>;
  ts: number;
}

let healthCache: HealthCache | null = null;
const HEALTH_TTL_MS = 30_000;

export async function getNodesWithHealth(forceHealth = false): Promise<NodeWithHealth[]> {
  const entries = await loadNodes();
  const now = Date.now();
  let healthMap: Map<string, NodeWithHealth> | null = null;
  if (!forceHealth && healthCache && now - healthCache.ts < HEALTH_TTL_MS) {
    healthMap = healthCache.byUrl;
  } else {
    try {
      const res = await fetch("/api/node-health");
      if (res.ok) {
        const body = (await res.json()) as { nodes?: unknown };
        const map = new Map<string, NodeWithHealth>();
        if (Array.isArray(body?.nodes)) {
          for (const h of body.nodes as NodeWithHealth[]) {
            map.set((h.url as string).replace(/\/$/, ""), h);
          }
        }
        healthCache = { byUrl: map, ts: now };
        healthMap = map;
      }
    } catch {
      // health fetch failed — entries will just lack health info
    }
  }
  return entries.map((e) => {
    const key = e.url.replace(/\/$/, "");
    const h = healthMap?.get(key);
    return { ...e, ...(h ?? {}) };
  });
}

export async function refreshHealth(): Promise<void> {
  healthCache = null;
  await getNodesWithHealth(true);
}

export function getStoredNodeUrl(): string | null {
  try {
    return localStorage.getItem(SELECTION_KEY);
  } catch {
    return null;
  }
}

export async function getNodeUrl(): Promise<string> {
  const stored = getStoredNodeUrl();
  if (stored) return stored;
  const entries = await loadNodes();
  return entries[0]?.url ?? HARDCODED_FALLBACK[0].url;
}

export function setStoredNodeUrl(url: string): void {
  try {
    localStorage.setItem(SELECTION_KEY, url);
  } catch {
    /* ignore */
  }
}

export function renderNodeListItems(
  list: HTMLElement,
  entries: NodeWithHealth[],
): void {
  list.replaceChildren();
  for (const entry of entries) {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.dataset.value = entry.url;
    li.className =
      "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-100 hover:bg-white/5";

    const dot =
      entry.alive === undefined
        ? "bg-slate-500"
        : entry.alive
        ? "bg-emerald-500"
        : "bg-rose-500";
    const dotEl = document.createElement("span");
    dotEl.className = `h-2 w-2 shrink-0 rounded-full ${dot}`;

    const meta = document.createElement("span");
    meta.className = "grow min-w-0";
    const name = document.createElement("div");
    name.textContent = entry.name;
    const urlEl = document.createElement("div");
    urlEl.className = "truncate text-xs text-slate-400";
    urlEl.textContent =
      entry.url.replace(/\/$/, "") + (entry.version ? ` · ${entry.version}` : "");
    meta.append(name, urlEl);

    li.append(dotEl, meta);
    list.appendChild(li);
  }
}
