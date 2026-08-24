// Password decrypt for Warthog wallet blobs — same formats as WartBunker:
// multi-auth envelope, v2 PBKDF2 JSON, and legacy CryptoJS OpenSSL AES.

import CryptoJS from "crypto-js";

const ENVELOPE_KIND = "warthog-wallet-v1";
const PBKDF2_ITERATIONS = 210_000;

function tryParseEnvelope(raw) {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("{")) return null;
  try {
    const obj = JSON.parse(s);
    if (obj && obj.kind === ENVELOPE_KIND && Number(obj.v) === 1) return obj;
    return null;
  } catch {
    return null;
  }
}

function decryptV2(envelope, password) {
  const iterations = Number(envelope.iter) > 0 ? Number(envelope.iter) : PBKDF2_ITERATIONS;
  const salt = CryptoJS.enc.Base64.parse(envelope.salt);
  const iv = CryptoJS.enc.Base64.parse(envelope.iv);
  const ciphertext = CryptoJS.enc.Base64.parse(envelope.ct);
  const key = CryptoJS.PBKDF2(String(password), salt, {
    keySize: 256 / 32,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  });
  const decrypted = CryptoJS.AES.decrypt({ ciphertext }, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error("Invalid password");
  return JSON.parse(decryptedStr);
}

function decryptLegacyOpenSsl(encrypted, password) {
  const bytes = CryptoJS.AES.decrypt(String(encrypted), String(password));
  const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error("Invalid password");
  return JSON.parse(decryptedStr);
}

export function decryptWallet(encrypted, password) {
  if (password == null || String(password).length === 0) {
    throw new Error("Invalid password");
  }
  const raw = String(encrypted ?? "").trim();
  if (!raw) throw new Error("Invalid password");

  const multi = tryParseEnvelope(raw);
  if (multi) {
    if (!multi.password) {
      throw new Error("This wallet has no password — unlock it on WartBunker or use the wallet file/seed");
    }
    return decryptWallet(multi.password, password);
  }

  if (raw.startsWith("{")) {
    try {
      const envelope = JSON.parse(raw);
      if (envelope && Number(envelope.v) === 2 && envelope.ct && envelope.salt && envelope.iv) {
        return decryptV2(envelope, password);
      }
    } catch (err) {
      if (err?.message === "Invalid password") throw err;
      if (!(err instanceof SyntaxError)) throw err;
    }
  }

  return decryptLegacyOpenSsl(raw, password);
}

export function listSavedWalletNames() {
  try {
    if (typeof localStorage === "undefined") return [];
    return Object.keys(localStorage)
      .filter((key) => key.startsWith("warthogWallet_"))
      .map((key) => key.replace("warthogWallet_", ""))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch {
    return [];
  }
}

export function loadSavedWalletBlob(name) {
  return localStorage.getItem(`warthogWallet_${name}`);
}
