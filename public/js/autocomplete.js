// Asset hash autocomplete + 64-char ticker lookup.
//
// As the user types in #f-asset-hash:
//   - 1-63 chars: debounced autocomplete against the testnet node's
//     /asset/complete?hashPrefix=... endpoint. Up to 10 results.
//   - exactly 64 hex chars: hide autocomplete, fire the 64-char lookup
//     against the testnet node's /asset/lookup/{hash}. On success,
//     fill #f-name with the ticker. Cache the result so re-types
//     are free.
//
// The testnet node URL comes from #f-node-input (which is the picker
// input — see node-picker.js). All requests go browser → testnet
// direct (no asset-metadata-js server proxy).

const MAX_RESULTS = 10;
const DEBOUNCE_MS = 200;
const MIN_PREFIX_LEN = 1;
const HASH_RE = /^[0-9a-fA-F]{64}$/;
const HARD_FALLBACK = "https://warthog-defitestnet.duckdns.org/";

function getCurrentNodeUrl() {
  const input = document.querySelector("#f-node-input");
  const typed = input instanceof HTMLInputElement ? input.value.trim() : "";
  if (typed) return typed;
  try {
    const stored = localStorage.getItem("warthog:selected-node-url");
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return HARD_FALLBACK;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t !== null) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
}

function hide(list) {
  list.classList.add("hidden");
  list.replaceChildren();
}

async function fetchComplete(baseUrl, prefix, signal) {
  const url =
    baseUrl.replace(/\/$/, "") +
    "/asset/complete?hashPrefix=" +
    encodeURIComponent(prefix);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body?.data?.matches) ? body.data.matches : [];
}

async function fetchLookup(baseUrl, hash, signal) {
  const url = baseUrl.replace(/\/$/, "") + "/asset/lookup/" + hash;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) return null;
  const body = await res.json();
  const name = body?.data?.name;
  if (typeof name !== "string") return null;
  const decimals =
    typeof body?.data?.decimals === "number" ? body.data.decimals : 0;
  return { name, decimals };
}

// Single-item cache (one lookup result). Cleared on each new lookup.
// Per user preference: "cache only has one item and no TTL" — but we
// do clear on each fresh lookup so a stale value doesn't leak across
// different hashes.
let lookupCache = { hash: "", result: null };

function showNameSpinner(show) {
  const s = document.getElementById("f-name-spinner");
  const status = document.getElementById("f-name-status");
  if (!s) return;
  if (show) {
    s.classList.remove("hidden");
    if (status) status.textContent = "Looking up ticker…";
  } else {
    s.classList.add("hidden");
    if (status) status.textContent = "";
  }
}

function fillName(name) {
  const nameInput = document.getElementById("f-name");
  if (!nameInput) return;
  nameInput.value = name;
  nameInput.dispatchEvent(new Event("change", { bubbles: true }));
}

function updateBorder(input) {
  input.classList.remove("border-white/10", "border-rose-500/60", "border-emerald-500/60");
  const v = input.value.trim();
  if (v.length === 0) {
    input.classList.add("border-white/10");
  } else if (!HASH_RE.test(v)) {
    input.classList.add("border-rose-500/60");
  } else {
    input.classList.add("border-emerald-500/60");
  }
}

function render(container, list, items) {
  list.replaceChildren();
  if (items.length === 0) {
    hide(list);
    return;
  }

  for (const item of items.slice(0, MAX_RESULTS)) {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.className =
      "flex cursor-pointer flex-col gap-0.5 px-3 py-2 font-mono text-xs hover:bg-white/5";

    const hash = document.createElement("span");
    hash.className = "break-all text-slate-100";
    hash.textContent = item.hash || "";

    const meta = document.createElement("span");
    const name = item.name || "";
    const decimals = item.decimals;
    const parts = [name, decimals !== undefined ? `${decimals} decimals` : ""].filter(Boolean);
    meta.className = "text-slate-400 font-sans";
    meta.textContent = parts.join(" · ");

    li.append(hash, meta);
    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const hashInput = container.querySelector('input[name="asset_hash"]');
      if (hashInput) {
        hashInput.value = item.hash || "";
        hashInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      hide(list);
    });
    list.append(li);
  }

  list.classList.remove("hidden");
}

function init(container) {
  const input = container.querySelector('input[name="asset_hash"]');
  const list = container.querySelector("[data-autocomplete-list]");
  if (!input || !list) return;

  let currentCtl = null;

  const debouncedComplete = debounce(async (prefix) => {
    currentCtl?.abort();
    const ctl = new AbortController();
    currentCtl = ctl;
    try {
      const items = await fetchComplete(getCurrentNodeUrl(), prefix, ctl.signal);
      if (currentCtl !== ctl) return;
      render(container, list, items);
    } catch (_err) {
      if (currentCtl !== ctl) return;
      hide(list);
    }
  }, DEBOUNCE_MS);

  async function fire64CharLookup(value) {
    showNameSpinner(true);
    const ctl = new AbortController();
    currentCtl = ctl;

    // Cache hit
    if (lookupCache.hash === value && lookupCache.result) {
      fillName(lookupCache.result.name);
      showNameSpinner(false);
      return;
    }

    try {
      const result = await fetchLookup(getCurrentNodeUrl(), value, ctl.signal);
      if (currentCtl !== ctl) return;
      showNameSpinner(false);
      if (result) {
        lookupCache = { hash: value, result };
        fillName(result.name);
      }
      // silent failure — f-name stays empty on null
    } catch (_err) {
      if (currentCtl !== ctl) return;
      showNameSpinner(false);
    }
  }

  input.addEventListener("input", () => {
    const value = input.value.trim();
    updateBorder(input);

    if (HASH_RE.test(value)) {
      // 64 valid hex chars — suppress autocomplete, fetch full lookup
      hide(list);
      void fire64CharLookup(value);
      return;
    }

    // 1-63 chars — autocomplete as before. Hide spinner if any.
    showNameSpinner(false);
    if (value.length < MIN_PREFIX_LEN) {
      hide(list);
      return;
    }
    debouncedComplete(value);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => hide(list), 120);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length >= MIN_PREFIX_LEN && !HASH_RE.test(input.value.trim())) {
      debouncedComplete(input.value.trim());
    }
  });
}

function initAll() {
  document.querySelectorAll("[data-autocomplete]").forEach(init);
}

export { initAll };
