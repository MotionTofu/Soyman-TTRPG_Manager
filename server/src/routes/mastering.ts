import { Router } from "express";
import { db } from "../db/db";

export const masteringRouter = Router();

masteringRouter.get("/", (req, res) => {
  const { category, system_id } = req.query as { category?: string; system_id?: string };
  const clauses = ["m.archived_at IS NULL"];
  const params: Record<string, string> = {};
  if (category) {
    clauses.push("category = @category");
    params.category = category;
  }
  if (system_id) {
    clauses.push("m.system_id = @system_id");
    params.system_id = system_id;
  }
  const rows = db
    .prepare(
      `SELECT m.*, s.name as system_name FROM mastering_notes m
       LEFT JOIN systems s ON s.id = m.system_id
       WHERE ${clauses.join(" AND ")} ORDER BY m.created_at DESC`
    )
    .all(params);
  res.json(rows);
});

masteringRouter.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM mastering_notes WHERE id = ?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

masteringRouter.post("/", (req, res) => {
  const { category, system_id, title, content } = req.body as {
    category: string;
    system_id?: number;
    title: string;
    content?: string;
  };
  if (!category || !title)
    return res.status(400).json({ error: "category and title are required" });
  const info = db
    .prepare(
      "INSERT INTO mastering_notes (category, system_id, title, content) VALUES (?, ?, ?, ?)"
    )
    .run(category, system_id ?? null, title, content || "");
  res
    .status(201)
    .json(
      db.prepare("SELECT * FROM mastering_notes WHERE id = ?").get(info.lastInsertRowid)
    );
});

masteringRouter.put("/:id", (req, res) => {
  const { title, content, system_id } = req.body as {
    title?: string;
    content?: string;
    system_id?: number | null;
  };
  db.prepare(
    `UPDATE mastering_notes SET
       title = COALESCE(?, title), content = COALESCE(?, content),
       system_id = COALESCE(?, system_id)
     WHERE id = ?`
  ).run(title ?? null, content ?? null, system_id ?? null, req.params.id);
  res.json(db.prepare("SELECT * FROM mastering_notes WHERE id = ?").get(req.params.id));
});

masteringRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE mastering_notes SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

masteringRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE mastering_notes SET archived_at = NULL WHERE id = ?").run(
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM mastering_notes WHERE id = ?").get(req.params.id));
});
