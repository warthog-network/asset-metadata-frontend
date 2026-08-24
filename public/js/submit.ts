// Form submission via fetch().
//
// Wires up any form with `data-submit-form`. The form is intercepted:
//   - event.preventDefault() so the browser doesn't navigate
//   - POST FormData to form.action via fetch()
//   - Read JSON response
//   - On success (body.ok === true): hide form, show success panel
//   - On error (body.ok === false): show error banner at top, leave the
//     form visible
//
// Also wires up client-side image validation + resize on file inputs
// marked with `data-validate-dimensions="W,H"` inside `[data-file-field]`.
//
// Submissions carry a wallet proof: the backend only accepts metadata
// signed by the asset's on-chain creator, so the submit handler fetches a
// challenge and attaches wallet_nonce + wallet_signature before POSTing.

import { attachWalletProof, currentAccount, initWalletLogin } from "./wallet.js";

function showError(message) {
  const banner = document.getElementById("submit-error");
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove("hidden");
  banner.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  const banner = document.getElementById("submit-error");
  if (!banner) return;
  banner.classList.add("hidden");
  banner.textContent = "";
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showSuccess(payload, form) {
  const panel = document.getElementById("submit-success");
  if (!panel) return;

  setText("success-asset-hash", payload.assetHash || "");
  setText("success-info-url", payload.infoUrl || "");
  const link = document.getElementById("success-info-link");
  if (link) link.href = payload.infoUrl || "#";

  panel.classList.remove("hidden");
  if (form) form.classList.add("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setSubmitting(form, submitting) {
  const btn = form.querySelector('button[type="submit"]');
  if (!btn) return;
  if (submitting) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = "Submitting…";
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
  }
}

// --- Image preview + dimension validation -------------------------------

function readDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
    };
    img.src = url;
  });
}

// Cheap dimension probe — same machinery as readDimensions, but the
// caller can decide whether to proceed regardless of size.
const quickDims = readDimensions;

function showPreview(file, imgEl, infoEl, statusEl, expectedW, expectedH, ok, dims) {
  const url = URL.createObjectURL(file);
  if (imgEl.dataset.objectUrl) URL.revokeObjectURL(imgEl.dataset.objectUrl);
  imgEl.src = url;
  imgEl.dataset.objectUrl = url;
  imgEl.classList.remove("hidden");

  infoEl.textContent = `${file.name} · ${dims.width}×${dims.height}`;
  statusEl.textContent = ok
    ? `Matches ${expectedW}×${expectedH} ✓`
    : `Must be exactly ${expectedW}×${expectedH}`;
  statusEl.className = ok ? "text-emerald-400" : "text-rose-400";
}

function clearPreview(imgEl, infoEl, statusEl) {
  if (imgEl.dataset.objectUrl) URL.revokeObjectURL(imgEl.dataset.objectUrl);
  imgEl.removeAttribute("src");
  imgEl.dataset.objectUrl = "";
  imgEl.classList.add("hidden");
  infoEl.textContent = "No file selected";
  statusEl.textContent = "";
  statusEl.className = "text-slate-500";
}

// Re-encode any canvas-decodable image to a PNG of EXACTLY (targetW ×
// targetH). The server accepts only those exact dimensions and does no
// resizing of its own, so this is what makes ordinary uploads work.
//
// The source is scaled to fit while preserving aspect ratio, then centered
// on a transparent canvas of the target size. Smaller sources are scaled
// up: the server would otherwise reject them outright, and an upscaled
// logo beats no logo. Callers warn about the quality loss.
//
// Throws if the browser cannot decode the source (e.g. HEIC in Chrome),
// which the caller treats as "leave the original alone".
async function reencodeToPng(file, targetW, targetH) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("could not decode image"));
      i.src = url;
    });

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    if (!srcW || !srcH) throw new Error("image has no dimensions");

    const ratio = Math.min(targetW / srcW, targetH / srcH);
    const innerW = Math.max(1, Math.round(srcW * ratio));
    const innerH = Math.max(1, Math.round(srcH * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      Math.round((targetW - innerW) / 2),
      Math.round((targetH - innerH) / 2),
      innerW,
      innerH,
    );

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
        "image/png",
      );
    });

    const name = file.name.replace(/\.[^.]+$/, "") + ".png";
    return {
      file: new File([blob], name, { type: "image/png" }),
      didReencode: true,
      originalType: file.type,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function initFileField(container, onChange) {
  const input = container.querySelector('input[type="file"]');
  if (!input) return;

  const required = container.dataset.required === "true";
  const dimsSpec = input.dataset.validateDimensions;
  const [expectedW, expectedH] = dimsSpec
    ? dimsSpec.split(",").map(Number)
    : [null, null];
  const autoResize = input.dataset.autoResize === "true";

  const id = input.id;
  const imgEl = container.querySelector("#" + id + "-preview");
  const infoEl = container.querySelector("#" + id + "-info");
  const statusEl = container.querySelector("#" + id + "-status");
  const errorEl = container.querySelector("#" + id + "-error");
  const warningEl = container.querySelector("#" + id + "-warning");

  let valid = !required;

  const update = () => onChange(valid);

  const showInlineError = (text) => {
    if (!errorEl) return;
    errorEl.textContent = text;
    errorEl.classList.remove("hidden");
  };
  const hideInlineError = () => {
    if (!errorEl) return;
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  };
  const showWarning = (text) => {
    if (!warningEl) return;
    const li = document.createElement("li");
    li.textContent = text;
    warningEl.appendChild(li);
    warningEl.classList.remove("hidden");
  };
  const hideWarning = () => {
    if (!warningEl) return;
    warningEl.replaceChildren();
    warningEl.classList.add("hidden");
  };

  const replaceFile = (newFile) => {
    const dt = new DataTransfer();
    dt.items.add(newFile);
    input.files = dt.files;
  };

  input.addEventListener("change", async () => {
    hideInlineError();
    hideWarning();

    const original = input.files && input.files[0];
    if (!original) {
      valid = !required;
      clearPreview(imgEl, infoEl, statusEl);
      update();
      return;
    }

    if (!dimsSpec) {
      valid = true;
      update();
      return;
    }

    try {
      let working = original;

      if (autoResize) {
        // If the file isn't already a valid PNG of the exact target
        // dimensions, force a canvas-toBlob re-encode. This converts HEIC,
        // WebP, BMP, etc. to PNG (when the browser can decode the source
        // for canvas) and resizes oversized PNGs in one pass. Without this,
        // iPhone HEIC photos hit the server unchanged and get rejected as
        // "not a PNG or JPEG".
        const currentDims = await quickDims(original);
        const needsReencode =
          original.type !== "image/png" ||
          currentDims.width !== expectedW ||
          currentDims.height !== expectedH;

        if (needsReencode) {
          let result: { file: File; didReencode: boolean; originalType: string } | null = null;
          try {
            result = await reencodeToPng(original, expectedW, expectedH);
          } catch {
            // Canvas couldn't decode the source (e.g. HEIC in Chrome).
            // Fall through to using the original file. The server will
            // reject non-PNG/JPEG if it can't parse them.
          }

          if (result) {
            replaceFile(result.file);
            working = result.file;

            if (original.type !== "image/png") {
              showWarning(
                `Original was ${original.type.split("/").pop() ?? "unknown"} — converted to PNG for upload.`,
              );
            } else {
              showWarning(
                `Resized to ${expectedW}×${expectedH}. Quality loss may occur from the re-encoding.`,
              );
            }
          }
        }
      }

      const dims = await readDimensions(working);
      const ok = dims.width === expectedW && dims.height === expectedH;
      valid = ok;
      showPreview(working, imgEl, infoEl, statusEl, expectedW, expectedH, ok, dims);

      if (!ok) {
        showInlineError(
          `Must be exactly ${expectedW}×${expectedH} px, got ${dims.width}×${dims.height} px.`,
        );
      }
    } catch (err) {
      valid = false;
      clearPreview(imgEl, infoEl, statusEl);
      showInlineError(
        `Could not read the image — make sure it is a valid PNG or JPEG. (${(err as Error).message ?? "unknown error"})`,
      );
    }

    update();
  });
}

function initForm(form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const fileStates = new Map();

  const recomputeSubmit = () => {
    if (!submitBtn) return;
    const allValid = Array.from(fileStates.values()).every(Boolean);
    // The server rejects unsigned submissions (401 challenge_required), so
    // the button stays disabled until a wallet is unlocked.
    submitBtn.disabled = !(allValid && currentAccount());
  };

  fileStates.clear();
  form.querySelectorAll("[data-file-field]").forEach((container) => {
    const input = container.querySelector('input[type="file"]');
    if (!input) return;
    fileStates.set(input.id, container.dataset.required !== "true");
  });
  recomputeSubmit();

  form.querySelectorAll("[data-file-field]").forEach((container) => {
    initFileField(container, (fieldValid) => {
      const input = container.querySelector('input[type="file"]');
      if (!input) return;
      fileStates.set(input.id, fieldValid);
      recomputeSubmit();
    });
  });

  form.addEventListener("wallet-change", recomputeSubmit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();
    setSubmitting(form, true);

    try {
      const data = new FormData(form);
      // Fetches a one-time challenge and signs it in-page. The private key
      // never leaves the browser — only the nonce + signature are sent.
      await attachWalletProof(data, data.get("asset_hash"));

      const response = await fetch(form.action, {
        method: form.method,
        body: data,
      });

      let body = null;
      try {
        body = await response.json();
      } catch (_err) {
        showError(`Server error (HTTP ${response.status}).`);
        return;
      }

      if (body && body.ok) {
        showSuccess(body, form);
      } else {
        showError((body && body.error) || `Server error (HTTP ${response.status}).`);
      }
    } catch (err) {
      showError("Network error: " + err.message);
    } finally {
      setSubmitting(form, false);
    }
  });
}

// The website links here with ?asset_hash=<hash> (or ?hash=), so prefill
// the field and let autocomplete.js fire its ticker lookup.
function prefillAssetHash() {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("asset_hash") || params.get("hash") || "").trim();
  const hash = raw.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return;
  const input = document.querySelector('#submit-form input[name="asset_hash"]');
  if (!input) return;
  input.value = hash;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function initAll() {
  initWalletLogin();
  prefillAssetHash();
  document.querySelectorAll("[data-submit-form]").forEach(initForm);

  const reset = document.getElementById("success-submit-another");
  if (reset) {
    reset.addEventListener("click", () => {
      const form = document.getElementById("submit-form");
      const panel = document.getElementById("submit-success");
      if (form) form.classList.remove("hidden");
      if (panel) panel.classList.add("hidden");
      hideError();
    });
  }
}

export { initAll };
