import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { artifactFolder, sanitizeName } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";
import { storeDeduped } from "../services/vaultDedup";

export const artifactsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

artifactsRouter.get("/", (req, res) => {
  const { setting_id } = req.query as { setting_id?: string };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  const rows = db
    .prepare(
      "SELECT * FROM artifacts WHERE setting_id = ? AND archived_at IS NULL ORDER BY name"
    )
    .all(setting_id);
  res.json(rows);
});

artifactsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

artifactsRouter.post("/", upload.single("file"), async (req, res) => {
  const { setting_id, name, owner, power, history, notes } = req.body as {
    setting_id: string;
    name: string;
    owner?: string;
    power?: string;
    history?: string;
    notes?: string;
  };
  if (!setting_id || !name)
    return res.status(400).json({ error: "setting_id and name are required" });
  const setting = db
    .prepare("SELECT folder_path FROM settings WHERE id = ?")
    .get(setting_id) as { folder_path: string } | undefined;
  if (!setting) return res.status(404).json({ error: "setting not found" });
  const folder = artifactFolder(setting.folder_path, name);

  let filePath: string | null = null;
  if (req.file) {
    const target = path.join(folder, sanitizeName(req.file.originalname));
    await storeDeduped(req.file.buffer, target);
    filePath = target;
  }

  const info = db
    .prepare(
      `INSERT INTO artifacts (setting_id, name, owner, power, history, notes, file_path, folder_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      setting_id,
      name,
      owner ?? "",
      power ?? "",
      history ?? "",
      notes ?? "",
      filePath,
      folder
    );
  res
    .status(201)
    .json(db.prepare("SELECT * FROM artifacts WHERE id = ?").get(info.lastInsertRowid));
});

artifactsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM artifacts WHERE id = ?")
    .get(req.params.id) as { folder_path: string; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });

  const { name, owner, power, history, notes, short_name } = req.body as Record<
    string,
    string | undefined
  >;
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  db.prepare(
    `UPDATE artifacts SET
       name = COALESCE(?, name), owner = COALESCE(?, owner),
       power = COALESCE(?, power), history = COALESCE(?, history),
       notes = COALESCE(?, notes),
       short_name = CASE WHEN ? THEN ? ELSE short_name END,
       folder_path = ?
     WHERE id = ?`
  ).run(
    name ?? null,
    owner ?? null,
    power ?? null,
    history ?? null,
    notes ?? null,
    short_name !== undefined ? 1 : 0,
    short_name ?? null,
    folderPath,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.id));
});

artifactsRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE artifacts SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

artifactsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE artifacts SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.id));
});
