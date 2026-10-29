import { Router } from "express";
import { db } from "../db/db";
import { soundFoldersReady } from "../db/soundFolders";

export const soundFoldersRouter = Router();
const ROLES = ["background", "ambient", "weather", "stinger"];

soundFoldersRouter.get("/", (_req, res) => {
  if (!soundFoldersReady(db)) return res.json([]);
  res.json(db.prepare("SELECT id, role, name FROM sound_folders ORDER BY name COLLATE NOCASE, id").all());
});

soundFoldersRouter.use((_req, res, next) => {
  if (!soundFoldersReady(db)) {
    return res.status(503).json({ error: "Папки аудиотеки ещё не подключены: требуется обновление базы." });
  }
  next();
});

soundFoldersRouter.post("/", (req, res) => {
  const { role, name } = req.body;
  if (!ROLES.includes(role) || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Укажите раздел и название папки." });
  }
  const result = db.prepare("INSERT INTO sound_folders (role, name) VALUES (?, ?)").run(role, name.trim());
  res.status(201).json({ id: Number(result.lastInsertRowid), role, name: name.trim() });
});

soundFoldersRouter.put("/:id", (req, res) => {
  const { name } = req.body;
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Укажите название папки." });
  }
  const result = db.prepare("UPDATE sound_folders SET name = ? WHERE id = ?").run(name.trim(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Папка не найдена." });
  res.json(db.prepare("SELECT id, role, name FROM sound_folders WHERE id = ?").get(req.params.id));
});

soundFoldersRouter.delete("/:id", (req, res) => {
  // Каскад удаляет только привязки папки. Ресурсы, байты, наборы и плейлисты
  // остаются прежними: звук снова показывается в корне своего раздела.
  const result = db.prepare("DELETE FROM sound_folders WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Папка не найдена." });
  res.json({ ok: true });
});
