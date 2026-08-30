import { Router } from "express";
import { db } from "../db/db";

export const masteringRouter = Router();

// --- Разделы (сворачиваемые, плашка — инверсия §1.4) --------------------
// Один набор на каждую категорию prep/live/knowledge, как res-group у Ресурсов
// и группы бестиария. Хвост «Без раздела» — заметки без section_id.
masteringRouter.get("/sections", (req, res) => {
  const { category } = req.query as { category?: string };
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (category) {
    clauses.push("category = @category");
    params.category = category;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT s.*, sys.name as system_name FROM mastering_sections s
       LEFT JOIN systems sys ON sys.id = s.system_id
       ${where} ORDER BY s.position ASC, s.created_at ASC, s.id ASC`
    )
    .all(params);
  res.json(rows);
});

masteringRouter.post("/sections", (req, res) => {
  const { category, name, system_id, position } = req.body as {
    category: string;
    name: string;
    system_id?: number | null;
    position?: number;
  };
  if (!category || !name?.trim())
    return res.status(400).json({ error: "category and name are required" });
  const pos =
    position ??
    ((db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as p FROM mastering_sections WHERE category = ?").get(category) as { p: number }).p);
  const info = db
    .prepare("INSERT INTO mastering_sections (category, name, system_id, position) VALUES (?, ?, ?, ?)")
    .run(category, name.trim(), system_id ?? null, pos);
  res
    .status(201)
    .json(db.prepare("SELECT * FROM mastering_sections WHERE id = ?").get(info.lastInsertRowid));
});

masteringRouter.put("/sections/:id", (req, res) => {
  const { name, system_id, position } = req.body as {
    name?: string;
    system_id?: number | null;
    position?: number;
  };
  const hasSystemId = Object.prototype.hasOwnProperty.call(req.body, "system_id");
  const hasPosition = Object.prototype.hasOwnProperty.call(req.body, "position");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined) {
    sets.push("name = ?");
    vals.push(name.trim());
  }
  if (hasSystemId) {
    sets.push("system_id = ?");
    vals.push(system_id ?? null);
  }
  if (hasPosition) {
    sets.push("position = ?");
    vals.push(position ?? 0);
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE mastering_sections SET ${sets.join(", ")} WHERE id = ?`).run(...vals, req.params.id);
  }
  res.json(db.prepare("SELECT * FROM mastering_sections WHERE id = ?").get(req.params.id));
});

masteringRouter.delete("/sections/:id", (req, res) => {
  const id = Number(req.params.id);
  // Заметки секции уходят в «Без раздела», а не в архив — иначе потеря.
  db.prepare("UPDATE mastering_notes SET section_id = NULL WHERE section_id = ?").run(id);
  db.prepare("DELETE FROM mastering_sections WHERE id = ?").run(id);
  res.json({ ok: true });
});

masteringRouter.get("/", (req, res) => {
  const { category, system_id, section_id, q, sort, limit, offset } = req.query as {
    category?: string;
    system_id?: string;
    section_id?: string;
    q?: string;
    sort?: string;
    limit?: string;
    offset?: string;
  };
  const clauses = ["m.archived_at IS NULL"];
  const params: Record<string, string> = {};
  if (category) {
    clauses.push("m.category = @category");
    params.category = category;
  }
  if (system_id) {
    clauses.push("m.system_id = @system_id");
    params.system_id = system_id;
  }
  if (section_id) {
    if (section_id === "null") clauses.push("m.section_id IS NULL");
    else {
      clauses.push("m.section_id = @section_id");
      params.section_id = section_id;
    }
  }
  if (q && q.trim()) {
    clauses.push("(lower(m.title) LIKE @q OR lower(m.content) LIKE @q)");
    params.q = `%${q.trim().toLowerCase()}%`;
  }
  const order =
    sort === "az" ? "lower(m.title) ASC, m.created_at DESC" : "m.created_at DESC";
  const lim = Math.min(200, Math.max(0, Number(limit) || 0));
  const off = Math.max(0, Number(offset) || 0);
  const pageClause = lim > 0 ? ` LIMIT ${lim} OFFSET ${off}` : "";
  const rows = db
    .prepare(
      `SELECT m.*, s.name as system_name, sec.name as section_name FROM mastering_notes m
       LEFT JOIN systems s ON s.id = m.system_id
       LEFT JOIN mastering_sections sec ON sec.id = m.section_id
       WHERE ${clauses.join(" AND ")} ORDER BY ${order}${pageClause}`
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
  const { category, system_id, section_id, title, content } = req.body as {
    category: string;
    system_id?: number | null;
    section_id?: number | null;
    title: string;
    content?: string;
  };
  if (!category || !title?.trim())
    return res.status(400).json({ error: "category and title are required" });
  const info = db
    .prepare(
      "INSERT INTO mastering_notes (category, section_id, system_id, title, content) VALUES (?, ?, ?, ?, ?)"
    )
    .run(category, section_id ?? null, system_id ?? null, title.trim(), content || "");
  res
    .status(201)
    .json(
      db.prepare("SELECT * FROM mastering_notes WHERE id = ?").get(info.lastInsertRowid)
    );
});

masteringRouter.put("/:id", (req, res) => {
  const { title, content, system_id, section_id } = req.body as {
    title?: string;
    content?: string;
    system_id?: number | null;
    section_id?: number | null;
  };
  const hasSystemId = Object.prototype.hasOwnProperty.call(req.body, "system_id");
  const hasSectionId = Object.prototype.hasOwnProperty.call(req.body, "section_id");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (title !== undefined) {
    sets.push("title = ?");
    vals.push(title);
  }
  if (content !== undefined) {
    sets.push("content = ?");
    vals.push(content);
  }
  if (hasSystemId) {
    sets.push("system_id = ?");
    vals.push(system_id ?? null);
  }
  if (hasSectionId) {
    sets.push("section_id = ?");
    vals.push(section_id ?? null);
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE mastering_notes SET ${sets.join(", ")} WHERE id = ?`).run(
      ...vals,
      req.params.id
    );
  }
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
