import { Router } from "express";
import { db } from "../db/db";

export const linkNotesRouter = Router();

linkNotesRouter.get("/", (req, res) => {
  const { link_id } = req.query as { link_id?: string };
  if (!link_id) return res.status(400).json({ error: "link_id is required" });
  const rows = db
    .prepare("SELECT * FROM link_notes WHERE link_id = ? ORDER BY created_at")
    .all(link_id);
  res.json(rows);
});

linkNotesRouter.post("/", (req, res) => {
  const { link_id, title, content } = req.body as {
    link_id: number;
    title?: string;
    content?: string;
  };
  if (!link_id) return res.status(400).json({ error: "link_id is required" });
  const info = db
    .prepare("INSERT INTO link_notes (link_id, title, content) VALUES (?, ?, ?)")
    .run(link_id, title ?? "", content ?? "");
  res.status(201).json(db.prepare("SELECT * FROM link_notes WHERE id = ?").get(info.lastInsertRowid));
});

linkNotesRouter.put("/:id", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare(
    "UPDATE link_notes SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?"
  ).run(title ?? null, content ?? null, req.params.id);
  res.json(db.prepare("SELECT * FROM link_notes WHERE id = ?").get(req.params.id));
});

linkNotesRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM link_notes WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
