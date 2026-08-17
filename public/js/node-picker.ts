// Browser-side UI for the Warthog node picker.
// The input is authoritative — user can type any URL.
// The "Choose" button opens a popover listing nodes fetched from
// data.warthog.network (with hardcoded fallback) and probed via
// /api/node-health. Picking a node fills the input and stores in
// localStorage so future loads remember the choice.

import {
  loadNodes,
  getStoredNodeUrl,
  setStoredNodeUrl,
  renderNodeListItems,
  getNodesWithHealth,
} from "../../src/lib/node-picker";

function init() {
  const container = document.querySelector("[data-node-picker]");
  if (!container) return;
  const input = container.querySelector("#f-node-input");
  const button = container.querySelector("#f-node-button");
  const list = container.querySelector("#f-node-list");
  if (!(input instanceof HTMLInputElement)) return;
  if (!(button instanceof HTMLButtonElement)) return;
  if (!(list instanceof HTMLElement)) return;

  let popoverOpen = false;

  async function openPopover() {
    // Load node list (cached) + fetch fresh health each open. The
    // /api/node-health endpoint is server-cached for 30s so this is
    // cheap even on rapid open/close.
    await loadNodes();
    const entries = await getNodesWithHealth();
    renderNodeListItems(list, entries);
    list.classList.remove("hidden");
    popoverOpen = true;
  }

  function closePopover() {
    list.classList.add("hidden");
    popoverOpen = false;
  }

  function togglePopover() {
    if (popoverOpen) {
      closePopover();
    } else {
      void openPopover();
    }
  }

  // Restore previous selection on load
  const stored = getStoredNodeUrl();
  if (stored) input.value = stored;

  button.addEventListener("click", () => togglePopover());

  list.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const li = target.closest("[data-value]") as HTMLLIElement | null;
    if (!li) return;
    const url = li.dataset.value;
    if (!url) return;
    input.value = url;
    setStoredNodeUrl(url);
    closePopover();
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  input.addEventListener("change", () => {
    const v = input.value.trim();
    if (v) setStoredNodeUrl(v);
  });

  document.addEventListener("click", (event) => {
    if (!popoverOpen) return;
    const target = event.target as Node;
    if (container.contains(target)) return;
    closePopover();
  });
}

function initAll() {
  document.querySelectorAll("[data-node-picker]").forEach(init);
}

export { initAll };
