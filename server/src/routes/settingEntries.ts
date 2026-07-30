import { Router } from "express";
import { db } from "../db/db";

export const settingEntriesRouter = Router();

settingEntriesRouter.get("/", (req, res) => {
  const { setting_id, category } = req.query as { setting_id?: string; category?: string };
  if (!setting_id || !category)
    return res.status(400).json({ error: "setting_id and category are required" });
  const rows = db
    .prepare(
      "SELECT * FROM setting_entries WHERE setting_id = ? AND category = ? ORDER BY created_at"
    )
    .all(setting_id, category);
  res.json(rows);
});

settingEntriesRouter.post("/", (req, res) => {
  const { setting_id, category, title, content } = req.body as {
    setting_id: number;
    category: string;
    title?: string;
    content?: string;
  };
  if (!setting_id || !category)
    return res.status(400).json({ error: "setting_id and category are required" });
  const info = db
    .prepare(
      "INSERT INTO setting_entries (setting_id, category, title, content) VALUES (?, ?, ?, ?)"
    )
    .run(setting_id, category, title ?? "", content ?? "");
  res
    .status(201)
    .json(db.prepare("SELECT * FROM setting_entries WHERE id = ?").get(info.lastInsertRowid));
});

settingEntriesRouter.put("/:id", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare(
    "UPDATE setting_entries SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?"
  ).run(title ?? null, content ?? null, req.params.id);
  res.json(db.prepare("SELECT * FROM setting_entries WHERE id = ?").get(req.params.id));
});

settingEntriesRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM setting_entries WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
