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
  const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const chapters = db
    .prepare("SELECT * FROM artifact_chapters WHERE artifact_id = ? ORDER BY created_at")
    .all(req.params.id);
  res.json({ ...row, chapters });
});

artifactsRouter.post("/", upload.single("file"), async (req, res) => {
  const { setting_id, name, owner, power, history, notes, item_type, rarity, requires_attunement } =
    req.body as {
      setting_id: string;
      name: string;
      owner?: string;
      power?: string;
      history?: string;
      notes?: string;
      item_type?: string;
      rarity?: string;
      requires_attunement?: string;
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
      `INSERT INTO artifacts (setting_id, name, owner, power, history, notes, item_type, rarity, requires_attunement, file_path, folder_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      setting_id,
      name,
      owner ?? "",
      power ?? "",
      history ?? "",
      notes ?? "",
      item_type ?? null,
      rarity ?? null,
      requires_attunement ? 1 : 0,
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

  const { name, owner, power, history, notes, short_name, item_type, rarity, requires_attunement } =
    req.body as Record<string, string | boolean | undefined>;
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name as string);
  }
  db.prepare(
    `UPDATE artifacts SET
       name = COALESCE(?, name), owner = COALESCE(?, owner),
       power = COALESCE(?, power), history = COALESCE(?, history),
       notes = COALESCE(?, notes),
       short_name = CASE WHEN ? THEN ? ELSE short_name END,
       item_type = CASE WHEN ? THEN ? ELSE item_type END,
       rarity = CASE WHEN ? THEN ? ELSE rarity END,
       requires_attunement = CASE WHEN ? THEN ? ELSE requires_attunement END,
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
    item_type !== undefined ? 1 : 0,
    item_type ?? null,
    rarity !== undefined ? 1 : 0,
    rarity ?? null,
    requires_attunement !== undefined ? 1 : 0,
    requires_attunement ? 1 : 0,
    folderPath,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.id));
});

artifactsRouter.post("/:id/chapters", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  const info = db
    .prepare("INSERT INTO artifact_chapters (artifact_id, title, content) VALUES (?, ?, ?)")
    .run(req.params.id, title ?? "", content ?? "");
  res
    .status(201)
    .json(db.prepare("SELECT * FROM artifact_chapters WHERE id = ?").get(info.lastInsertRowid));
});

artifactsRouter.put("/chapters/:chapterId", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare(
    "UPDATE artifact_chapters SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?"
  ).run(title ?? null, content ?? null, req.params.chapterId);
  res.json(db.prepare("SELECT * FROM artifact_chapters WHERE id = ?").get(req.params.chapterId));
});

artifactsRouter.delete("/chapters/:chapterId", (req, res) => {
  db.prepare("DELETE FROM artifact_chapters WHERE id = ?").run(req.params.chapterId);
  res.json({ ok: true });
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
