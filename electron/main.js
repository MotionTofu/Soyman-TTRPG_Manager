const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

const PORT = 4732;
const isPackaged = app.isPackaged;

// Point the server at per-user data folders instead of the developer's
// hardcoded paths, so each installed copy keeps its own campaigns/vault.
// These are only used to seed the *default* storage profile on first run —
// after that, server/src/services/storages.ts tracks the active storage
// (and CONFIG_DIR, set below, is where that registry itself lives; it must
// stay put even when the user switches which storage is active).
const userData = app.getPath("userData");
process.env.CONFIG_DIR = path.join(userData, "config");
process.env.DB_DIR = path.join(userData, "data");
process.env.VAULT_ROOT = path.join(userData, "RPG-Vault");
process.env.PORT = String(PORT);

// The "full" flavor bundles a `seed` resources folder (see seedIfNeeded()
// below); the "empty" flavor doesn't. Reuse that same signal to tell the
// server's migration (server/src/db/db.ts) not to seed its four default,
// content-less systems — the empty build should open on a truly blank app.
if (isPackaged && !fs.existsSync(path.join(process.resourcesPath, "seed"))) {
  process.env.SEED_DEFAULT_SYSTEMS = "false";
}

// In dev (running from the repo) server/dist sits next to this file's
// parent; in the packaged app everything is laid out the same way inside
// the resources folder because asar is disabled for this build.
const serverEntry = path.join(__dirname, "..", "server", "dist", "index.js");

// The "full" portable build ships a `seed` folder (see extraResources in
// electron-builder.full.json, built by scripts/build-seed.js) containing a
// DB + vault pre-loaded with Системы/Сеттинги. On a brand-new install (no DB
// yet in this user's data folder) we copy that seed in before the server
// starts. The "empty" build has no `seed` folder, so this is a no-op there.
// Never overwrites an existing DB — only runs once, on first launch.
function seedIfNeeded() {
  if (!isPackaged) return;
  const seedRoot = path.join(process.resourcesPath, "seed");
  if (!fs.existsSync(seedRoot)) return;
  const dbFile = path.join(process.env.DB_DIR, "app.db");
  if (fs.existsSync(dbFile)) return;

  const seedDb = path.join(seedRoot, "data", "app.db");
  const seedVault = path.join(seedRoot, "vault");
  const vaultRootMarker = path.join(seedRoot, "vault-root.txt");
  try {
    if (fs.existsSync(seedDb)) {
      fs.mkdirSync(process.env.DB_DIR, { recursive: true });
      fs.copyFileSync(seedDb, dbFile);
    }
    if (fs.existsSync(seedVault)) {
      fs.mkdirSync(process.env.VAULT_ROOT, { recursive: true });
      fs.cpSync(seedVault, process.env.VAULT_ROOT, { recursive: true });
    }
    // The DB's path columns still say wherever the seed was built from
    // (e.g. "E:\RPG-Vault\..."). Rewrite every occurrence to this install's
    // actual vault path so images/files resolve correctly.
    if (fs.existsSync(vaultRootMarker) && fs.existsSync(dbFile)) {
      const oldVaultRoot = fs.readFileSync(vaultRootMarker, "utf-8").trim();
      if (oldVaultRoot) rewriteVaultPaths(dbFile, oldVaultRoot, process.env.VAULT_ROOT);
    }
  } catch (err) {
    console.error("Failed to seed initial data:", err);
  }
}

// (table, column) pairs that store an absolute vault-relative path — see
// server/src/db/schema.sql. Campaign/character/session tables are excluded
// since seedIfNeeded only ever runs against the pruned "systems + settings"
// seed DB, which has no rows in those tables.
const VAULT_PATH_COLUMNS = [
  ["systems", "folder_path"],
  ["systems", "thumbnail_image_path"],
  ["settings", "folder_path"],
  ["settings", "background_image_path"],
  ["settings", "thumbnail_image_path"],
  ["setting_locations", "folder_path"],
  ["setting_locations", "map_image_path"],
  ["setting_beings", "avatar_image_path"],
  ["setting_beings", "thumbnail_image_path"],
  ["setting_beings", "folder_path"],
  ["setting_communities", "folder_path"],
  ["setting_communities", "thumbnail_image_path"],
  ["artifacts", "file_path"],
  ["artifacts", "folder_path"],
  ["resources", "file_path"],
  ["gallery_images", "image_path"],
];

function rewriteVaultPaths(dbFile, oldVaultRoot, newVaultRoot) {
  const Database = require(path.join(
    process.resourcesPath,
    "app",
    "server",
    "node_modules",
    "better-sqlite3"
  ));
  const db = new Database(dbFile);
  try {
    for (const [table, column] of VAULT_PATH_COLUMNS) {
      db.prepare(
        `UPDATE ${table} SET ${column} = REPLACE(${column}, ?, ?) WHERE ${column} LIKE ? || '%'`
      ).run(oldVaultRoot, newVaultRoot, oldVaultRoot);
    }
  } finally {
    db.close();
  }
}

function waitForServer(url, attempt = 0) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume();
        resolve();
      })
      .on("error", () => {
        if (attempt > 100) return reject(new Error("Server did not start in time"));
        setTimeout(() => waitForServer(url, attempt + 1).then(resolve, reject), 150);
      });
  });
}

// Auto-update: checks GitHub Releases (see package.json's "build.publish"),
// downloads silently in the background, then asks before restarting — never
// installs without the GM's OK, since that would yank the app out from under
// an in-progress session. Only wired up in packaged builds: the dev run has
// no publish feed configured and would just log noisy errors every launch.
autoUpdater.autoInstallOnAppQuit = false;

// Mirrors every autoUpdater event to the renderer (as "update-status") so the
// in-app "Проверить обновления" button (Настройки → О программе) can show
// live progress, not just the native menu/dialog flow.
function setupAutoUpdater(win) {
  const send = (payload) => {
    if (!win.isDestroyed()) win.webContents.send("update-status", payload);
  };
  autoUpdater.on("checking-for-update", () => send({ status: "checking" }));
  autoUpdater.on("update-available", (info) => send({ status: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => send({ status: "not-available" }));
  autoUpdater.on("download-progress", (p) => send({ status: "downloading", percent: p.percent }));
  autoUpdater.on("update-downloaded", async (info) => {
    send({ status: "downloaded", version: info.version });
    const result = await dialog.showMessageBox(win, {
      type: "info",
      title: "Обновление готово",
      message: `Доступна версия ${info.version}. Установить и перезапустить приложение?`,
      buttons: ["Перезапустить и установить", "Позже"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", (err) => {
    console.error("Auto-update error:", err);
    send({ status: "error", message: String(err) });
  });
}

function checkForUpdates() {
  if (!isPackaged) return;
  autoUpdater.checkForUpdates().catch((err) => console.error("Update check failed:", err));
}

function createMenu() {
  const template = [
    {
      label: "Файл",
      submenu: [
        {
          label: "Открыть папку с данными",
          click: () => shell.openPath(userData),
        },
        {
          label: "Открыть папку хранилища (RPG-Vault)",
          click: () => shell.openPath(process.env.VAULT_ROOT),
        },
        { type: "separator" },
        {
          label: "Проверить обновления…",
          click: checkForUpdates,
        },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "reload", label: "Обновить" },
        { role: "toggleDevTools", label: "Инструменты разработчика" },
        { type: "separator" },
        { role: "resetZoom", label: "Сбросить масштаб" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Полный экран" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("pick-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("check-for-updates", () => {
  if (!isPackaged) return { ok: false, reason: "dev" };
  checkForUpdates();
  return { ok: true };
});

ipcMain.handle("quit-and-install", () => {
  autoUpdater.quitAndInstall();
});

async function createWindow() {
  seedIfNeeded();
  require(serverEntry);
  await waitForServer(`http://127.0.0.1:${PORT}/api/health`);

  createMenu();

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "SoyMan_ttrpg",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.loadURL(`http://127.0.0.1:${PORT}`);

  if (!isPackaged) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  setupAutoUpdater(win);
  checkForUpdates();
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
