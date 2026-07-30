const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const isPackaged = app.isPackaged;
const userData = app.getPath("userData");
const configPath = path.join(userData, "config.json");
const cachePath = path.join(userData, "cache.json");

// Same "thin client, no bundled server" architecture as player-app (see
// ../../player-app/README.md) — the difference here is the bridge surface:
// игрок-клиент has a handful of well-defined writes (notes, statblock
// content), so a dedicated method per operation made sense. мобил-мастер is
// mostly READ access across many different data shapes (campaigns, sessions,
// beings, compendium, playlists, resources) with one write (show-image) — a
// generic apiGet/apiPost pass-through plus a path-keyed cache covers all of
// that without a bespoke method (and bespoke cache slot) per data type.
function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getConfig() {
  return readJson(configPath, { serverUrl: "", token: "", username: "" });
}

function getCache() {
  return readJson(cachePath, {});
}

async function apiFetch(reqPath, options = {}) {
  const config = getConfig();
  if (!config.serverUrl) throw new Error("not connected");
  const res = await fetch(`${config.serverUrl.replace(/\/$/, "")}${reqPath}`, {
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

ipcMain.handle("get-state", () => {
  const config = getConfig();
  return {
    connected: !!config.token,
    serverUrl: config.serverUrl,
    username: config.username,
    savedPassword: config.password || "",
    token: config.token,
    cache: getCache(),
  };
});

ipcMain.handle("connect", async (_evt, { serverUrl, username, password, remember }) => {
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Не удалось войти");
  if (body.user.role !== "gm") throw new Error("Этот аккаунт не мастерский — нужен gm-аккаунт");
  writeJson(configPath, { serverUrl, token: body.token, username, password: remember ? password : undefined });
  return { ok: true, user: body.user };
});

ipcMain.handle("disconnect", () => {
  const config = getConfig();
  writeJson(configPath, { ...config, token: "" });
  return { ok: true };
});

ipcMain.handle("api-get", async (_evt, { path: reqPath }) => {
  const data = await apiFetch(reqPath);
  const cache = getCache();
  cache[reqPath] = data;
  writeJson(cachePath, cache);
  return data;
});

ipcMain.handle("api-post", async (_evt, { path: reqPath, body }) => {
  return apiFetch(reqPath, { method: "POST", body: body ? JSON.stringify(body) : undefined });
});

function createMenu() {
  const template = [
    { label: "Файл", submenu: [{ role: "quit", label: "Выход" }] },
    {
      label: "Вид",
      submenu: [
        { role: "reload", label: "Обновить" },
        { role: "toggleDevTools", label: "Инструменты разработчика" },
        { type: "separator" },
        { role: "resetZoom", label: "Сбросить масштаб" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  createMenu();
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "RPG Manager — Мастер (мобильный)",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const devUrl = process.env.GM_APP_DEV_URL;
  if (!isPackaged && devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "client", "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
