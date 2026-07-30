const BASE = "/api";
const TOKEN_KEY = "rpgManagerAuthToken";

// Auth is always on — every deployment (local desktop included) logs in and
// carries a bearer token; LoginGate.tsx shows the login/setup form on 401.
let token: string | null = localStorage.getItem(TOKEN_KEY);
let onUnauthorized: (() => void) | null = null;

export function getAuthToken(): string | null {
  return token;
}
export function setAuthToken(next: string | null): void {
  token = next;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else localStorage.removeItem(TOKEN_KEY);
}
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// Every /files/... URL embedded anywhere in a JSON response (avatar_image_url,
// thumbnail_image_url, file_url, background_image_url, ...) needs the same
// bearer token plain <img>/<audio> tags can't attach as a header — appended
// here once, centrally, instead of touching every page that renders one.
function withFileTokens<T>(value: T): T {
  if (typeof value === "string") {
    if (value.startsWith("/files/") && token) {
      const sep = value.includes("?") ? "&" : "?";
      return (value + sep + "token=" + encodeURIComponent(token)) as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => withFileTokens(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = withFileTokens(v);
    return out as T;
  }
  return value;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options?.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : undefined),
      ...options?.headers,
    },
  });
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok) {
    // The server's error handler returns { error: "message" }; surface just
    // that instead of the raw "500 …: {json}" so UI shows a clean message.
    const text = await res.text();
    let message = text || `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      /* not JSON — keep the raw text */
    }
    throw new Error(message);
  }
  return withFileTokens(await res.json());
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// A handful of delete routes (gallery images, a location's map) can respond
// 409 { needsChoice: true } when the file being removed is the *last*
// remaining link to its content anywhere in the vault (see
// server/src/services/vaultDedup.ts) — everywhere else, deletion just
// proceeds normally. Returns false if the user backs out entirely (nothing
// was deleted); throws on a real server error.
export async function deleteFileWithChoice(path: string): Promise<boolean> {
  const doDelete = (mode?: "forever" | "archive") =>
    fetch(`${BASE}${path}${mode ? `?mode=${mode}` : ""}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

  let res = await doDelete();
  if (res.status === 409) {
    const toArchive = confirm(
      "Это последняя копия этого файла в хранилище.\n\nOK — отправить в архив (файл останется доступен на странице «Архив»).\nОтмена — выбрать «удалить навсегда»."
    );
    if (toArchive) {
      res = await doDelete("archive");
    } else {
      const forever = confirm("Удалить файл НАВСЕГДА без возможности восстановления?");
      if (!forever) return false;
      res = await doDelete("forever");
    }
  }
  if (!res.ok) throw new Error(await res.text());
  return true;
}
