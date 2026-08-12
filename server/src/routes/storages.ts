import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";
import { openDatabase, switchToDatabase } from "../db/db";
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
const upload = multer({ storage: multer.memoryStorage() });

storagesRouter.get("/", (_req, res) => {
  const { activeId, storages } = listStorages();
  res.json({ activeId, storages });
});

storagesRouter.post("/", (req, res) => {
  const { name, folderPath } = req.body as { name?: string; folderPath?: string };
  if (!name || !folderPath)
    return res.status(400).json({ error: "name and folderPath are required" });

  const dbDir = path.join(folderPath, "data");
  const vaultRoot = path.join(folderPath, "RPG-Vault");
  try {
    openDatabase(dbDir).close();
    initVaultAt(vaultRoot);
  } catch (err) {
    return res.status(400).json({ error: "Не удалось создать хранилище: " + String(err) });
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
    res.status(400).json({ error: String(err) });
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
    res.status(500).json({ error: "Не удалось переключить хранилище: " + String(err) });
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-import-"));
  try {
    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(tmpDir, true);

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
    res.status(500).json({ error: "Не удалось импортировать бэкап: " + String(err) });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

storagesRouter.get("/current-vault-root", (_req, res) => {
  res.json({ vaultRoot: VAULT_ROOT });
});
