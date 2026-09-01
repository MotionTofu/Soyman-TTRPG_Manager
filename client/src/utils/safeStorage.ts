const PREFIX = "soyman:";

function prefixed(key: string): string {
  return key.startsWith(PREFIX) ? key : `${PREFIX}${key}`;
}

export function safeGetItem(key: string, fallback: string | null = null): string | null {
  const pk = prefixed(key);
  try {
    const v = localStorage.getItem(pk);
    if (v !== null) return v;
    // fallback: try old key without prefix for migration
    const old = localStorage.getItem(key);
    if (old !== null) {
      // migrate
      try { localStorage.setItem(pk, old); } catch {}
      return old;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(prefixed(key), value); } catch {}
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(prefixed(key));
    // also clean old
    localStorage.removeItem(key);
  } catch {}
}

export function safeGetJSON<T>(key: string, fallback: T): T {
  const raw = safeGetItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function safeSetJSON(key: string, value: unknown): void {
  try { safeSetItem(key, JSON.stringify(value)); } catch {}
}
