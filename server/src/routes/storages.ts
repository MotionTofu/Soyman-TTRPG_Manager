import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";
import { compactIfBloated, databaseFill, db, openDatabase, switchToDatabase } from "../db/db";
import { initVaultAt, setVaultRoot, VAULT_ROOT } from "../services/filesystem";
import {
  addStorage,
  getActiveStorage,
  listStorages,
  removeStorage,
  setActiveStorageId,
  updateStorage,
} from "../services/storages";

export const storagesRouter = Router();
// 500 МБ — с запасом под 230 МБ модули с музыкой (согласовано с владельцем).
const MAX_BACKUP_BYTES = 500 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `rpg-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: MAX_BACKUP_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".zip")) {
      return cb(new Error("Нужен .zip бэкапа"));
    }
    cb(null, true);
  },
});

function isSafeFolderPath(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  if (p.includes("\0")) return false;
  if (!path.isAbsolute(p)) return false;
  if (p.length > 1024) return false;
  // U+202E etc — bidi override
  if (/[\u202A-\u202E\u200B-\u200F\uFEFF]/.test(p)) return false;
  const resolved = path.resolve(path.normalize(p));
  // Нормализованный путь не должен содержать .. сегмент
  if (resolved.split(path.sep).includes("..")) return false;
  if (p.split(/[\\/]/).includes("..")) return false;
  return true;
}
function hasZipSlipEntry(entryName: string): boolean {
  if (!entryName) return true;
  if (entryName.includes("\0")) return true;
  let decoded = entryName;
  try { decoded = decodeURIComponent(entryName); } catch {}
  // U+202E etc
  if (/[\u202A-\u202E\u200B-\u200F\uFEFF]/.test(decoded)) return true;
  const normalized = path.posix.normalize(decoded.replace(/\\/g, "/"));
  if (path.isAbsolute(decoded) || path.isAbsolute(normalized)) return true;
  if (normalized.split("/").includes("..")) return true;
  if (decoded.split(/[\\/]/).includes("..")) return true;
  if (/^[a-zA-Z]:/.test(decoded) || /^[a-zA-Z]:/.test(normalized)) return true;
  if (decoded.startsWith("/") || decoded.startsWith("\\") || normalized.startsWith("/")) return true;
  if (decoded.startsWith("\\\\") || normalized.startsWith("//")) return true;
  if (decoded.includes(":") && /^[a-zA-Z]:/.test(decoded)) return true;
  return false;
}

storagesRouter.get("/", (_req, res) => {
  const { activeId, storages } = listStorages();
  res.json({ activeId, storages });
});

storagesRouter.post("/", (req, res) => {
  const { name, folderPath } = req.body as { name?: string; folderPath?: string };
  if (!name || !folderPath)
    return res.status(400).json({ error: "name and folderPath are required" });
  if (!isSafeFolderPath(folderPath)) {
    return res.status(400).json({ error: "Недопустимый путь к папке" });
  }

  const dbDir = path.join(folderPath, "data");
  const vaultRoot = path.join(folderPath, "RPG-Vault");
  try {
    openDatabase(dbDir).close();
    initVaultAt(vaultRoot);
  } catch (err) {
    console.error("[POST /storages]", err);
    return res.status(400).json({ error: "Не удалось создать хранилище" });
  }

  const profile = addStorage(name, dbDir, vaultRoot);
  res.status(201).json(profile);
});

storagesRouter.put("/:id", (req, res) => {
  const { name } = req.body as { name?: string };
  try {
    res.json(updateStorage(req.params.id, { name }));
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

storagesRouter.delete("/:id", (req, res) => {
  try {
    removeStorage(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /storages/:id]", err);
    res.status(400).json({ error: "Не удалось удалить хранилище" });
  }
});

storagesRouter.post("/:id/activate", (req, res) => {
  const { storages } = listStorages();
  const target = storages.find((s) => s.id === req.params.id);
  if (!target) return res.status(404).json({ error: "storage not found" });

  try {
    switchToDatabase(target.dbDir);
    setVaultRoot(target.vaultRoot);
    setActiveStorageId(target.id);
    res.json({ ok: true, active: target });
  } catch (err) {
    console.error("[POST /storages/:id/activate]", err);
    res.status(500).json({ error: "Не удалось переключить хранилище" });
  }
});

storagesRouter.get("/active", (_req, res) => {
  res.json(getActiveStorage());
});

// Extracts a backup zip (created by POST /api/backup — an app.db file plus
// an RPG-Vault/ folder at the archive root) into a new storage profile.
storagesRouter.post("/import-backup", upload.single("file"), (req, res) => {
  const { name, folderPath } = req.body as { name?: string; folderPath?: string };
  if (!req.file) return res.status(400).json({ error: "file is required" });
  if (!name || !folderPath)
    return res.status(400).json({ error: "name and folderPath are required" });
  if (!isSafeFolderPath(folderPath)) {
    if (req.file.path) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: "Недопустимый путь к папке" });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-import-"));
  const uploadedPath = (req.file as Express.Multer.File & { path?: string }).path ?? null;
  try {
    const MAX_ENTRIES = 10000;
    const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1GB
    const zipBuffer = uploadedPath ? fs.readFileSync(uploadedPath) : (req.file as unknown as { buffer: Buffer }).buffer;
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    if (entries.length > MAX_ENTRIES) {
      return res.status(400).json({ error: `Слишком много файлов в архиве: ${entries.length} > ${MAX_ENTRIES}` });
    }
    let totalUncompressed = 0;
    for (const entry of entries) {
      if (hasZipSlipEntry(entry.entryName)) {
        return res.status(400).json({ error: `Недопустимый путь в архиве: ${entry.entryName}` });
      }
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
        return res.status(400).json({ error: "Архив распаковывается в >1GB — отклонён (ZipBomb)" });
      }
      // Симлинки в zip имеют спец атрибут; AdmZip их распакует как файл-линк
      // Проверим после распаковки lstat'ом, но и здесь отсечём по externalFileAttributes
      const isSymlink = (entry.header.attr >>> 16) === 0o120000;
      if (isSymlink) {
        return res.status(400).json({ error: `Симлинк в архиве запрещён: ${entry.entryName}` });
      }
    }
    zip.extractAllTo(tmpDir, true);
    // Пост-проверка: архив мог содержать симлинки, которые extractAllTo создал на диске
    function hasSymlinkRecursive(dir: string): string | null {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const it of items) {
        const full = path.join(dir, it.name);
        try {
          const lst = fs.lstatSync(full);
          if (lst.isSymbolicLink()) return full;
          if (lst.isDirectory()) {
            const found = hasSymlinkRecursive(full);
            if (found) return found;
          }
        } catch {}
      }
      return null;
    }
    const symlinkPath = hasSymlinkRecursive(tmpDir);
    if (symlinkPath) {
      return res.status(400).json({ error: `Симлинк в архиве запрещён: ${path.relative(tmpDir, symlinkPath)}` });
    }

    const extractedDb = path.join(tmpDir, "app.db");
    const extractedVault = path.join(tmpDir, "RPG-Vault");
    if (!fs.existsSync(extractedDb)) {
      return res.status(400).json({ error: "В архиве не найден app.db — это не бэкап SoyMan_ttrpg" });
    }

    const dbDir = path.join(folderPath, "data");
    const vaultRoot = path.join(folderPath, "RPG-Vault");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.copyFileSync(extractedDb, path.join(dbDir, "app.db"));

    if (fs.existsSync(extractedVault)) {
      fs.cpSync(extractedVault, vaultRoot, { recursive: true });
    } else {
      initVaultAt(vaultRoot);
    }

    // Make sure the imported DB is already on the current schema version.
    openDatabase(dbDir).close();

    const profile = addStorage(name, dbDir, vaultRoot);
    res.status(201).json(profile);
  } catch (err) {
    console.error("[POST /storages/import-backup]", err);
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Архив слишком большой — лимит 500 МБ" });
    }
    res.status(500).json({ error: "Не удалось импортировать бэкап" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (uploadedPath) try { fs.unlinkSync(uploadedPath); } catch {}
  }
});

storagesRouter.get("/current-vault-root", (_req, res) => {
  res.json({ vaultRoot: VAULT_ROOT });
});

// Сколько места в файле базы занимает пустота от удалённых строк. SQLite не
// возвращает его системе сам — файл не худеет никогда, пока его не перестроят.
storagesRouter.get("/db-size", (_req, res) => {
  res.json(databaseFill(db as unknown as Parameters<typeof databaseFill>[0]));
});

// Перестройка файла по кнопке — тот же VACUUM, что случается сам при старте,
// когда пустоты набирается больше половины.
storagesRouter.post("/compact", (_req, res) => {
  const target = db as unknown as Parameters<typeof databaseFill>[0];
  const before = databaseFill(target);
  compactIfBloated(target, true);
  res.json({ before, after: databaseFill(target) });
});
