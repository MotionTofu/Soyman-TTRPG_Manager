// Persistent-storage helpers (phase A2.3).
//
// Framework-free so node:test covers the UX mapping without a browser.
// Contract: navigator.storage.persist() is called ONLY from an explicit user
// gesture (the "Защитить данные" button). Mount queries persisted() and
// estimate() read-only — never persist() — so no permission prompt appears
// at startup. Unsupported browsers degrade to a neutral status, never an
// error; persistence is informational, never mandatory.

// Structural subset of StorageManager so tests can pass plain fakes.
export function storageApiKind(storage) {
  if (!storage || typeof storage.persisted !== 'function' || typeof storage.persist !== 'function') {
    return 'unsupported';
  }
  return 'supported';
}

// Simple "~XX МБ" diagnostic. Returns null when there is nothing sane to show.
export function formatLocalBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  return `~${Math.round(bytes / (1024 * 1024))} МБ`;
}

// Read-only snapshot for the Advanced section. Never calls persist().
export async function readStorageStatus(storage) {
  if (storageApiKind(storage) === 'unsupported') {
    return { supported: false, persisted: null, usageText: null };
  }
  let persisted = null;
  try {
    persisted = await storage.persisted();
  } catch {
    persisted = null;
  }
  let usageText = null;
  try {
    if (typeof storage.estimate === 'function') {
      const estimate = await storage.estimate();
      const text = formatLocalBytes(estimate?.usage);
      if (text) usageText = `Использовано локально: ${text}`;
    }
  } catch {
    // Estimate is best-effort diagnostics; its absence hides the line.
  }
  return {
    supported: true,
    persisted: persisted == null ? null : Boolean(persisted),
    usageText,
  };
}

// Explicit user action only. Resolves { ok } — the caller maps failure to the
// neutral "depends on browser" status, never to an error banner.
export async function requestPersistentStorage(storage) {
  try {
    return { ok: Boolean(await storage.persist()) };
  } catch {
    return { ok: false };
  }
}

// Gentle, non-blocking backup nudge: only when the browser reports storage as
// evictable AND the user already has characters. Rendered as plain text in
// Advanced — never a popup, never an automatic download.
export function shouldAdviseBackup({ supported, persisted, hasCharacters }) {
  return supported === true && persisted === false && hasCharacters === true;
}

export function storageProtectionText({ supported, persisted }) {
  if (!supported) return 'Защита хранения: зависит от браузера';
  if (persisted === true) return 'Защита хранения: включена';
  if (persisted === false) return 'Браузер может очищать данные при нехватке места';
  return 'Защита хранения: зависит от браузера';
}
