import { isBusyEditing, notifyDataChanged } from "../dataSync";

const BASE = "/api";
const TOKEN_KEY = "rpgManagerAuthToken";

// Auth is always on — every deployment (local desktop included) logs in and
// carries a bearer token; LoginGate.tsx shows the login/setup form on 401.
let token: string | null = localStorage.getItem(TOKEN_KEY);
let onUnauthorized: (() => void) | null = null;

// Другое окно («Новое окно» — в нём регистрируется/входит другой мастер
// или тот же) сменило токен в localStorage, а наш токен в памяти застыл на
// значении, прочитанном при загрузке модуля. Если это не слушать, окно,
// открытое до входа, продолжает слать запросы без токена: чтения тихо
// отдают пустоту, любая запись отвечает 401, и на экране не меняется
// ничего — работа теряется без предупреждения (П0.6).
// storage-событие приходит только в *другие* окна того же адреса, поэтому
// собственный вход/выход этот слушатель не заденет (setAuthToken в этом же
// окне storage не порождает).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== TOKEN_KEY) return;
    const next = localStorage.getItem(TOKEN_KEY);
    if (next === token) return;
    token = next;
    // Токен сменился — перезагружаемся, чтобы страницы перечитали юзера и
    // сбросили кеш currentUser (как LoginScreen и делает на входе). Но не
    // под руками: если в этом окне печатают, дожидаемся возврата фокуса,
    // иначе потеряем тот самый недописанный текст, который и защищаем.
    if (isBusyEditing() || !document.hasFocus()) {
      window.addEventListener("focus", () => window.location.reload(), { once: true });
    } else {
      window.location.reload();
    }
  });
}

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
// Оптимизация P-09: клонируем только url-поля, не весь объект, и не трогаем description/text.
function isUrlKey(k: string): boolean {
  return k.toLowerCase().endsWith("_url");
}
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
    let changed = false;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && v.startsWith("/files/") && token && isUrlKey(k)) {
        const sep = v.includes("?") ? "&" : "?";
        out[k] = v + sep + "token=" + encodeURIComponent(token);
        changed = true;
      } else if (v && typeof v === "object") {
        const next = withFileTokens(v as unknown as T);
        out[k] = next;
        if (next !== v) changed = true;
      } else {
        out[k] = v;
      }
    }
    // Если ни одно url-поле не менялось и вложенные объекты те же — возвращаем исходный, без аллокации
    if (!changed) return value;
    return out as T;
  }
  return value;
}

async function request<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const method = (options?.method ?? "GET").toUpperCase();
  const { timeoutMs: rawTimeout, ...rest } = (options ?? {}) as RequestInit & { timeoutMs?: number };
  const timeoutMs = rawTimeout ?? 10000;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (rest.signal) {
    rest.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(rest.body && !(rest.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : undefined),
        ...(token ? { Authorization: `Bearer ${token}` } : undefined),
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      if (timedOut) throw new Error("Сервер не отвечает (таймаут 10с) — попробуйте ещё раз");
      throw e;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    if (rest.signal) rest.signal.removeEventListener("abort", onExternalAbort);
  }
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
  // Любая удачная правка — повод остальным окнам приложения обновиться: они
  // работают с той же базой, но своей копией уже загруженных данных.
  if (method !== "GET") notifyDataChanged();
  return withFileTokens(await res.json());
}

export const api = {
  get: <T>(path: string, options?: RequestInit & { timeoutMs?: number }) => request<T>(path, options),
  post: <T>(path: string, body?: unknown, options?: RequestInit & { timeoutMs?: number }) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
      ...options,
    }),
  put: <T>(path: string, body?: unknown, options?: RequestInit & { timeoutMs?: number }) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}), ...options }),
  del: <T>(path: string, options?: RequestInit & { timeoutMs?: number }) => request<T>(path, { method: "DELETE", ...options }),
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
  notifyDataChanged();
  return true;
}
