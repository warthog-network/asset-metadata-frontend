// Entry point: mounts submit, autocomplete, and node-picker modules on
// DOMContentLoaded. Everything else (form interaction, fetch, validation)
// lives in submit.js / autocomplete.js / node-picker.js.

import { initAll as initSubmit } from "./submit.js";
import { initAll as initAutocomplete } from "./autocomplete.js";
import { initAll as initNodePicker } from "./node-picker.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initSubmit();
    initNodePicker();
    initAutocomplete();
  });
} else {
  initSubmit();
  initNodePicker();
  initAutocomplete();
}
