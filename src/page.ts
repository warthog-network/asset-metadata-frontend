// The Warthog-branded submission form, rendered to a single static page.
//
// `apiUrl` is the absolute URL of the backend's POST endpoint, baked into
// the form's action at build time (see scripts/build-static.ts). The page
// is served as static files, so it cannot derive the URL at request time —
// and the API lives on a different origin anyway.

export function renderHome(apiUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Warthog Asset Metadata</title>
  <link rel="icon" href="/images/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/images/favicon.png" sizes="any" type="image/png" />
  <link rel="apple-touch-icon" href="/images/favicon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/app.css" />
  <script defer src="/js/app.js"></script>
</head>
<body class="min-h-screen text-slate-50">
  <main class="mx-auto max-w-xl px-4 py-16 sm:px-6 lg:px-8">
    <header class="mb-8 flex items-start gap-4">
      <img src="/images/warthog-mark.svg" width="48" height="48" alt="" class="mt-1 shrink-0" />
      <div>
        <p class="m-0 font-montserrat text-xs font-semibold uppercase tracking-[0.15em] text-sky-400">Asset Info</p>
        <h1 class="mt-1 font-montserrat text-3xl font-bold leading-tight text-slate-50">Upload Asset Metadata</h1>
      </div>
    </header>

    <div id="submit-error" role="alert" class="mb-5 hidden rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"></div>

    <section class="rounded-xl border border-white/10 bg-[rgba(8,12,24,0.75)] p-6 shadow-[0_15px_30px_rgba(2,6,14,0.65)] sm:p-8">
      <p class="mt-0 text-base leading-6 text-slate-300">
        Add or update the public metadata for a Warthog asset to
        <code class="font-mono text-[0.92em] text-slate-200">warthog-network/public-data</code>
        (plus optional logo and banner) via a pull request.
      </p>

      <div class="mt-5 rounded-lg border border-white/10 bg-black/30 px-4 py-3">
        <span class="block font-montserrat text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-slate-400">
          API endpoint
        </span>
        <code id="api-endpoint" class="mt-1 block break-all font-mono text-sm text-slate-100"></code>
      </div>

      <div class="mt-5 rounded-lg border border-white/10 bg-black/30 px-4 py-3" data-node-picker>
        <label for="f-node-input" class="block font-montserrat text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-slate-400">
          Warthog node
        </label>
        <div class="relative mt-1">
          <!-- min-w-0 on the input is load-bearing: a bare flex item won't
               shrink below its intrinsic width, and an <input> carries a
               ~20ch one, which pushed the shrink-0 button off-screen on
               narrow phones. -->
          <div class="flex gap-2">
            <input
              id="f-node-input"
              type="url"
              name="warthog_node"
              placeholder="https://warthog-defitestnet.duckdns.org/"
              class="min-w-0 grow rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30"
            />
            <button
              id="f-node-button"
              type="button"
              class="flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-white/30 focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30"
            >
              <svg class="h-4 w-4 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              <span>Choose</span>
            </button>
          </div>
          <ul
            id="f-node-list"
            role="listbox"
            class="absolute left-0 right-0 z-20 mt-1 hidden max-h-72 overflow-auto rounded-lg border border-white/10 bg-[rgba(8,12,24,0.98)] py-1 shadow-[0_15px_30px_rgba(2,6,14,0.65)] backdrop-blur"
          ></ul>
          <p class="mt-1 text-xs text-slate-500">Used only for client-side autocomplete and ticker lookup.</p>
        </div>
      </div>

      <div id="wallet-panel" data-wallet-login class="mt-5 rounded-lg border border-white/10 bg-black/30 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="m-0 font-montserrat text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-slate-400">Warthog wallet</p>
            <p id="wallet-status" class="mt-1 text-sm text-slate-300">
              Unlock the same way as WartBunker — saved wallet, file, seed, or private key.
            </p>
            <p id="wallet-address" class="mt-1 hidden break-all font-mono text-xs text-emerald-200"></p>
          </div>
          <button id="wallet-lock" type="button" class="hidden shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5">
            Lock
          </button>
        </div>

        <div id="wallet-unlock" class="mt-4 flex flex-col gap-3">
          <div class="flex flex-wrap gap-2">
            <button type="button" data-wallet-tab="saved" class="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5">Saved wallet</button>
            <button type="button" data-wallet-tab="file" class="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5">Wallet file</button>
            <button type="button" data-wallet-tab="seed" class="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5">Seed phrase</button>
            <button type="button" data-wallet-tab="key" class="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5">Private key</button>
          </div>

          <div data-wallet-pane="saved">
            <p class="m-0 text-xs text-slate-400">
              Named wallets stored in this browser (<code class="font-mono">warthogWallet_*</code>). WartBunker saves on its own origin — use a wallet file if you unlocked there.
            </p>
            <label for="wallet-saved" class="mt-2 block text-sm font-medium text-slate-200">Wallet</label>
            <select id="wallet-saved" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-[#FDB913]"></select>
            <label for="wallet-saved-password" class="mt-2 block text-sm font-medium text-slate-200">Password</label>
            <input id="wallet-saved-password" type="password" autocomplete="current-password" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-[#FDB913]" />
          </div>

          <div data-wallet-pane="file" class="hidden">
            <p class="m-0 text-xs text-slate-400">
              Same encrypted <code class="font-mono">warthog_wallet.txt</code> WartBunker downloads.
            </p>
            <label for="wallet-file" class="mt-2 block text-sm font-medium text-slate-200">Wallet file</label>
            <input id="wallet-file" type="file" accept=".txt,.json,text/plain,application/json" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 file:mr-3 file:rounded file:border-0 file:bg-[#FDB913] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-900" />
            <label for="wallet-file-password" class="mt-2 block text-sm font-medium text-slate-200">Password</label>
            <input id="wallet-file-password" type="password" autocomplete="current-password" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-[#FDB913]" />
          </div>

          <div data-wallet-pane="seed" class="hidden">
            <label for="wallet-seed" class="text-sm font-medium text-slate-200">Seed phrase</label>
            <textarea id="wallet-seed" rows="2" autocomplete="off" spellcheck="false" placeholder="12 or 24 words" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-[#FDB913]"></textarea>
            <label for="wallet-path" class="mt-2 block text-sm font-medium text-slate-200">Derivation path</label>
            <select id="wallet-path" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-[#FDB913]">
              <option value="m/44'/2070'/0'/0/0">Hardened m/44'/2070'/0'/0/0 (WartBunker default)</option>
              <option value="m/44'/2070'/0/0/0">Standard m/44'/2070'/0/0/0</option>
            </select>
          </div>

          <div data-wallet-pane="key" class="hidden">
            <label for="wallet-key" class="text-sm font-medium text-slate-200">Private key</label>
            <input id="wallet-key" type="password" autocomplete="off" spellcheck="false" placeholder="64 hex characters" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-[#FDB913]" />
          </div>

          <p id="wallet-error" class="hidden text-sm text-rose-300"></p>
          <button id="wallet-unlock-btn" type="button" class="inline-flex w-fit items-center rounded-full bg-gradient-to-br from-[#FDB913] to-[#E79300] px-5 py-2 text-sm font-semibold text-slate-900">
            Unlock wallet
          </button>
        </div>
      </div>

      <form
        id="submit-form"
        data-submit-form
        method="POST"
        action="${apiUrl}"
        enctype="multipart/form-data"
        class="mt-8 flex flex-col gap-5"
      >
        <div class="flex flex-col gap-1.5" data-autocomplete>
          <label for="f-asset-hash" class="text-sm font-medium text-slate-200">
            Asset hash <span class="text-rose-400">*</span>
            <span class="text-slate-500">(64 hex chars)</span>
          </label>
          <div class="relative">
            <input
              id="f-asset-hash"
              type="text"
              name="asset_hash"
              pattern="[0-9a-fA-F]{64}"
              required
              autocomplete="off"
              value="0000000000000000000000000000000000000000000000000000000000000000"
              class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-sm text-slate-100 outline-none transition focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30"
            />
            <ul data-autocomplete-list role="listbox" class="absolute left-0 right-0 z-10 mt-1 hidden max-h-72 overflow-auto rounded-lg border border-white/10 bg-[rgba(8,12,24,0.98)] py-1 shadow-[0_15px_30px_rgba(2,6,14,0.65)] backdrop-blur"></ul>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="f-name" class="text-sm font-medium text-slate-200">
            Long name <span class="text-rose-400">*</span>
            <span class="text-slate-500">(≤ 15 chars)</span>
          </label>
          <div class="relative">
            <input id="f-name" type="text" name="name" required maxlength="15"
              class="w-full rounded-lg border border-white/10 bg-black/30 pr-10 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30" />
            <span id="f-name-spinner" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden text-slate-400" aria-hidden="true">
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
            </span>
            <span id="f-name-status" class="sr-only" role="status" aria-live="polite"></span>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="f-desc" class="text-sm font-medium text-slate-200">
            Description <span class="text-rose-400">*</span>
            <span class="text-slate-500">(≤ 500 chars)</span>
          </label>
          <textarea id="f-desc" name="description" required maxlength="500" rows="3"
            class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30"></textarea>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label for="f-website" class="text-sm font-medium text-slate-200">Website</label>
            <input id="f-website" type="url" name="website" maxlength="2048" placeholder="https://"
              class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="f-telegram" class="text-sm font-medium text-slate-200">Telegram</label>
            <input id="f-telegram" type="url" name="telegram" maxlength="2048" placeholder="https://t.me/"
              class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="f-discord" class="text-sm font-medium text-slate-200">Discord</label>
            <input id="f-discord" type="url" name="discord" maxlength="2048" placeholder="https://discord.com/"
              class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="f-twitter" class="text-sm font-medium text-slate-200">X / Twitter</label>
            <input id="f-twitter" type="url" name="twitter" maxlength="2048" placeholder="https://x.com/"
              class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-[#FDB913] focus:ring-2 focus:ring-[#FDB913]/30" />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5" data-file-field data-required="true">
            <label for="f-logo" class="text-sm font-medium text-slate-200">
              Logo <span class="text-rose-400">*</span>
              <span class="text-slate-500">(PNG/JPG, 250×250 px)</span>
            </label>
            <input id="f-logo" type="file" name="logo" required accept="image/png,image/jpeg"
              data-validate-dimensions="250,250" data-auto-resize="true"
              class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 file:mr-3 file:rounded file:border-0 file:bg-[#FDB913] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-900 hover:file:bg-[#E79300]" />
            <div class="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-2 min-h-[3.5rem]">
              <img id="f-logo-preview" alt="" class="hidden h-14 w-14 rounded border border-white/10 object-cover" />
              <div class="flex min-w-0 flex-col text-xs">
                <span id="f-logo-info" class="truncate text-slate-400">No file selected</span>
                <span id="f-logo-status" class="text-slate-500"></span>
              </div>
            </div>
            <ul id="f-logo-warning" class="hidden m-0 list-none space-y-1 p-0 text-sm text-amber-300"></ul>
            <p id="f-logo-error" class="hidden text-sm text-rose-300"></p>
          </div>
          <div class="flex flex-col gap-1.5" data-file-field data-required="false">
            <label for="f-banner" class="text-sm font-medium text-slate-200">
              Banner <span class="text-slate-500">(PNG/JPG, 600×200 px)</span>
            </label>
            <input id="f-banner" type="file" name="banner" accept="image/png,image/jpeg"
              data-validate-dimensions="600,200"
              class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 file:mr-3 file:rounded file:border-0 file:bg-[#FDB913] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-900 hover:file:bg-[#E79300]" />
            <div class="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-2 min-h-[3.5rem]">
              <img id="f-banner-preview" alt="" class="hidden h-14 w-44 rounded border border-white/10 object-cover" />
              <div class="flex min-w-0 flex-col text-xs">
                <span id="f-banner-info" class="truncate text-slate-400">No file selected</span>
                <span id="f-banner-status" class="text-slate-500"></span>
              </div>
            </div>
            <ul id="f-banner-warning" class="hidden m-0 list-none space-y-1 p-0 text-sm text-amber-300"></ul>
            <p id="f-banner-error" class="hidden text-sm text-rose-300"></p>
          </div>
        </div>

        <button type="submit"
          class="mt-2 inline-flex w-fit items-center gap-2 self-start rounded-full bg-gradient-to-br from-[#FDB913] to-[#E79300] px-6 py-2.5 font-montserrat text-sm font-semibold text-slate-900 shadow-[0_15px_30px_rgba(253,185,19,0.25)] transition hover:-translate-y-px hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0">
          Submit
        </button>
      </form>

      <div id="submit-success" class="mt-8 hidden rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 shadow-[0_15px_30px_rgba(2,6,14,0.65)]">
        <div class="flex items-center gap-3">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <h2 class="m-0 font-montserrat text-lg font-semibold text-emerald-100">Metadata published</h2>
        </div>
        <p class="mt-3 text-sm text-emerald-100/80">
          Your metadata is live in the asset catalog and served from this host.
          It is available immediately at the info URL below.
        </p>
        <dl class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
          <dt class="text-xs font-semibold uppercase tracking-wider text-emerald-200/70">Asset hash</dt>
          <dd id="success-asset-hash" class="m-0 break-all font-mono text-sm text-emerald-50"></dd>
          <dt class="text-xs font-semibold uppercase tracking-wider text-emerald-200/70">Info URL</dt>
          <dd class="m-0 break-all font-mono text-sm">
            <a id="success-info-link" href="#" target="_blank" rel="noreferrer noopener" class="text-emerald-200 underline decoration-emerald-500/40 underline-offset-2 hover:text-emerald-100"><span id="success-info-url"></span></a>
          </dd>
        </dl>
        <button id="success-submit-another" type="button"
          class="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/5">
          Submit another asset
        </button>
      </div>
    </section>
  </main>

  <script>
    // Fill in the API endpoint box once the DOM is ready. Server-rendered
    // form.action is already correct; this is just the human-readable box.
    document.addEventListener("DOMContentLoaded", () => {
      const form = document.getElementById("submit-form");
      const box = document.getElementById("api-endpoint");
      if (form && box) box.textContent = form.action;
    });
  </script>
</body>
</html>`;
}
