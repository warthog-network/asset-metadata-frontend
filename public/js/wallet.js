// In-page Warthog wallet unlock + signature65.
//
// Keys stay in memory. The server never sees the private key — submit
// fetches a challenge and attaches wallet_nonce + wallet_signature.

import { ethers } from "ethers";
import { decryptWallet, listSavedWalletNames, loadSavedWalletBlob } from "./walletCrypto.js";

let session = null;

export function currentAccount() {
  return session;
}

export function lockWallet() {
  session = null;
}

function openerAlive() {
  try {
    return Boolean(window.opener) && !window.opener.closed;
  } catch {
    return false;
  }
}

function requestOpener(payload, acceptType, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!openerAlive()) {
      reject(new Error("WartBunker window is gone — unlock here instead"));
      return;
    }
    const id = payload.id;
    const onMsg = (event) => {
      if (event.source !== window.opener) return;
      const data = event.data || {};
      if (id && data.id && data.id !== id) return;
      if (data.type === acceptType) {
        cleanup();
        resolve(data);
        return;
      }
      if (data.type === "wart-metadata-error" && (!id || data.id === id)) {
        cleanup();
        reject(new Error(data.error || "WartBunker signing failed"));
      }
    };
    const cleanup = () => {
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
    };
    window.addEventListener("message", onMsg);
    window.opener.postMessage(payload, "*");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WartBunker did not respond — keep that tab open"));
    }, timeoutMs);
  });
}

async function tryRemoteSession() {
  if (!openerAlive()) return false;
  try {
    const reply = await requestOpener({ type: "wart-metadata-hello" }, "wart-metadata-account", 2500);
    if (!reply?.ok || !reply.address) {
      if (reply?.error) showWalletError(reply.error);
      return false;
    }
    session = { address: String(reply.address).toLowerCase(), remote: true };
    setStatus(true, session.address);
    document.getElementById("submit-form")?.dispatchEvent(new Event("wallet-change"));
    return true;
  } catch {
    return false;
  }
}

function cleanHex(value) {
  return String(value || "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase();
}

export function addressFromCompressedPub(pubHex) {
  const pub = ethers.getBytes(pubHex.startsWith("0x") ? pubHex : "0x" + pubHex);
  const sha = ethers.getBytes(ethers.sha256(pub));
  const ripe = ethers.getBytes(ethers.ripemd160(sha));
  const checksum = ethers.getBytes(ethers.sha256(ripe)).slice(0, 4);
  return ethers.hexlify(ethers.concat([ripe, checksum])).slice(2);
}

export function accountFromPrivateKey(hex) {
  const clean = cleanHex(hex);
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error("private key must be 64 hex characters");
  }
  const key = new ethers.SigningKey("0x" + clean);
  const publicKey = key.compressedPublicKey.slice(2);
  return {
    privateKey: clean,
    publicKey,
    address: addressFromCompressedPub(publicKey),
    key,
  };
}

export function accountFromMnemonic(phrase, path) {
  const mnemonic = String(phrase || "").trim().replace(/\s+/g, " ");
  const words = mnemonic.split(" ");
  if (words.length !== 12 && words.length !== 24) {
    throw new Error("seed phrase must be 12 or 24 words");
  }
  const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, "", path);
  return accountFromPrivateKey(wallet.privateKey);
}

export function signMessage(account, message) {
  const digest = ethers.sha256(ethers.toUtf8Bytes(message));
  const sig = account.key.sign(digest);
  const r = sig.r.slice(2).padStart(64, "0");
  const s = sig.s.slice(2).padStart(64, "0");
  const yParity = sig.yParity ?? (typeof sig.v === "number" ? sig.v % 2 : 0);
  const recid = Number(yParity).toString(16).padStart(2, "0");
  return (r + s + recid).toLowerCase();
}

function setStatus(connected, address) {
  const status = document.getElementById("wallet-status");
  const addrEl = document.getElementById("wallet-address");
  const unlock = document.getElementById("wallet-unlock");
  const lockBtn = document.getElementById("wallet-lock");
  if (!status) return;

  if (connected) {
    status.textContent = session?.remote
      ? "Unlocked from WartBunker — keep that tab open to submit."
      : "Unlocked — only this address can publish assets it minted.";
    if (addrEl) {
      addrEl.textContent = address;
      addrEl.classList.remove("hidden");
    }
    if (unlock) unlock.classList.add("hidden");
    if (lockBtn) lockBtn.classList.remove("hidden");
  } else {
    status.textContent =
      "Unlock the same way as WartBunker — saved wallet, file, seed, or private key.";
    if (addrEl) {
      addrEl.textContent = "";
      addrEl.classList.add("hidden");
    }
    if (unlock) unlock.classList.remove("hidden");
    if (lockBtn) lockBtn.classList.add("hidden");
  }
}

function showWalletError(text) {
  const el = document.getElementById("wallet-error");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

function setTab(tab) {
  document.querySelectorAll("[data-wallet-tab]").forEach((btn) => {
    const active = btn.dataset.walletTab === tab;
    btn.className = active
      ? "rounded-full bg-[#FDB913] px-3 py-1 text-xs font-semibold text-slate-900"
      : "rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5";
  });
  document.querySelectorAll("[data-wallet-pane]").forEach((pane) => {
    pane.classList.toggle("hidden", pane.dataset.walletPane !== tab);
  });
}

function fillSavedWalletSelect() {
  const select = document.getElementById("wallet-saved");
  if (!select) return [];
  const names = listSavedWalletNames();
  select.replaceChildren();
  if (names.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No named wallets in this browser";
    select.append(opt);
    select.disabled = true;
    return names;
  }
  select.disabled = false;
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  }
  return names;
}

function accountFromDecrypted(data) {
  const priv = data?.privateKey || data?.private_key;
  if (!priv) throw new Error("wallet blob is missing a private key");
  return accountFromPrivateKey(priv);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("could not read wallet file"));
    reader.readAsText(file);
  });
}

async function unlockFromTab(tab) {
  if (tab === "saved") {
    const name = document.getElementById("wallet-saved")?.value || "";
    const password = document.getElementById("wallet-saved-password")?.value || "";
    if (!name) throw new Error("select a saved wallet");
    if (!password) throw new Error("enter the wallet password");
    const blob = loadSavedWalletBlob(name);
    if (!blob) throw new Error("selected wallet not found in this browser");
    return accountFromDecrypted(decryptWallet(blob, password));
  }

  if (tab === "file") {
    const file = document.getElementById("wallet-file")?.files?.[0];
    const password = document.getElementById("wallet-file-password")?.value || "";
    if (!file) throw new Error("choose a warthog_wallet.txt file");
    if (!password) throw new Error("enter the wallet password");
    const blob = await readFileAsText(file);
    return accountFromDecrypted(decryptWallet(blob, password));
  }

  if (tab === "seed") {
    const phrase = document.getElementById("wallet-seed")?.value || "";
    const path = document.getElementById("wallet-path")?.value || "m/44'/2070'/0'/0/0";
    return accountFromMnemonic(phrase, path);
  }

  return accountFromPrivateKey(document.getElementById("wallet-key")?.value || "");
}

function clearUnlockFields() {
  const ids = [
    "wallet-key",
    "wallet-seed",
    "wallet-saved-password",
    "wallet-file-password",
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  }
  const file = document.getElementById("wallet-file");
  if (file) file.value = "";
}

export function initWalletLogin() {
  const panel = document.querySelector("[data-wallet-login]");
  if (!panel) return;

  const names = fillSavedWalletSelect();
  let tab = names.length > 0 ? "saved" : "file";
  setTab(tab);

  panel.querySelectorAll("[data-wallet-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tab = btn.dataset.walletTab;
      setTab(tab);
      showWalletError("");
    });
  });

  const unlockBtn = document.getElementById("wallet-unlock-btn");
  if (unlockBtn) {
    unlockBtn.addEventListener("click", async () => {
      showWalletError("");
      unlockBtn.disabled = true;
      try {
        session = await unlockFromTab(tab);
        clearUnlockFields();
        setStatus(true, session.address);
        document.getElementById("submit-form")?.dispatchEvent(new Event("wallet-change"));
      } catch (err) {
        session = null;
        const msg = err?.message || String(err);
        showWalletError(msg === "Invalid password" ? "Invalid password — try again" : msg);
      } finally {
        unlockBtn.disabled = false;
      }
    });
  }

  const lockBtn = document.getElementById("wallet-lock");
  if (lockBtn) {
    lockBtn.addEventListener("click", () => {
      lockWallet();
      setStatus(false, "");
      document.getElementById("submit-form")?.dispatchEvent(new Event("wallet-change"));
    });
  }

  setStatus(false, "");
  void tryRemoteSession();
}

// The frontend is deployed separately from the API (Netlify -> VPS), so
// the challenge URL can't be relative. The submit form's action is the
// absolute API URL baked in at build time, so derive the base from it and
// keep one source of truth. Falls back to same-origin for local dev.
function apiBase() {
  const form = document.getElementById("submit-form");
  const action = form?.getAttribute("action") || "";
  if (/^https?:\/\//i.test(action)) return action.replace(/\/submit$/, "");
  return "/api";
}

export async function attachWalletProof(formData, assetHash) {
  if (!session) {
    throw new Error("unlock a Warthog wallet first");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(assetHash || "")) {
    throw new Error("asset hash must be 64 hex chars");
  }

  const res = await fetch(
    apiBase() + "/auth/challenge?asset_hash=" + encodeURIComponent(assetHash.toLowerCase()),
  );
  const body = await res.json().catch(() => null);
  // {ok: true, data: {message, nonce, expiresIn}} on success,
  // {ok: false, error: {code, message}} on failure — see the backend's
  // AssetMetadataServiceWeb.Envelope.
  const challenge = body?.data;
  if (!body || !body.ok || !challenge?.message || !challenge?.nonce) {
    throw new Error(body?.error?.message || "could not get wallet challenge");
  }

  let signature;
  if (session.remote) {
    const signed = await requestOpener(
      {
        type: "wart-metadata-sign",
        id: challenge.nonce,
        message: challenge.message,
      },
      "wart-metadata-signed",
      20000,
    );
    if (!signed?.ok || !signed.signature) {
      throw new Error(signed?.error || "WartBunker did not sign the challenge");
    }
    signature = signed.signature;
  } else {
    signature = signMessage(session, challenge.message);
  }

  formData.set("wallet_nonce", challenge.nonce);
  formData.set("wallet_signature", signature);
  return session.address;
}
