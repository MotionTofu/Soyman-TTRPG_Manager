// Fallback for window.gmApp when no Electron preload script has installed
// one — plain-browser testing and, for real, the Capacitor WebView (мобил-
// мастер has no main process to delegate to). See player-app's webBridge.ts
// for the fuller explanation of this pattern; identical reasoning here.
import type { AppState } from "./types";

const CONFIG_KEY = "gmAppConfig";
const CACHE_KEY = "gmAppCache";

// Strips whitespace and any embedded userinfo (the "user:pass@" part) before
// the address ever reaches fetch() — Safari throws "URL is not valid or
// contains user credentials" and refuses to send the request outright if
// that slips in (e.g. from a mobile browser's form-autofill guessing a
// saved login belongs in the "server address" field, since it sits right
// next to username/password fields on this screen).
function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Некорректный адрес сервера");
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
}

interface StoredConfig {
  serverUrl: string;
  token: string;
  username: string;
  // Only set when the user opted in via "Запомнить пароль" — see connect().
  password?: string;
}

function getConfig(): StoredConfig {
  const raw = localStorage.getItem(CONFIG_KEY);
  return raw ? JSON.parse(raw) : { serverUrl: "", token: "", username: "" };
}
function setConfig(config: StoredConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
function getCache(): Record<string, unknown> {
  const raw = localStorage.getItem(CACHE_KEY);
  return raw ? JSON.parse(raw) : {};
}
function setCache(cache: Record<string, unknown>) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const config = getConfig();
  if (!config.serverUrl) throw new Error("not connected");
  const res = await fetch(`${config.serverUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function installWebBridge() {
  window.gmApp = {
    async getState(): Promise<AppState> {
      const config = getConfig();
      return {
        connected: !!config.token,
        serverUrl: config.serverUrl,
        username: config.username,
        savedPassword: config.password ?? "",
        token: config.token,
        cache: getCache(),
      };
    },
    async connect(serverUrlRaw, username, password, remember) {
      const serverUrl = normalizeServerUrl(serverUrlRaw);
      const res = await fetch(`${serverUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось войти");
      if (data.user.role !== "gm") throw new Error("Этот аккаунт не мастерский — нужен gm-аккаунт");
      setConfig({ serverUrl, token: data.token, username, password: remember ? password : undefined });
      return { ok: true, user: data.user };
    },
    async disconnect() {
      const config = getConfig();
      setConfig({ ...config, token: "" });
      return { ok: true };
    },
    async apiGet(path) {
      const data = await apiFetch(path);
      const cache = getCache();
      cache[path] = data;
      setCache(cache);
      return data as never;
    },
    async apiPost(path, body) {
      return apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }) as never;
    },
  };
}
