import { Router } from "express";
import { db } from "../db/db";

export const initiativeEntriesRouter = Router();

initiativeEntriesRouter.get("/", (req, res) => {
  const { session_id } = req.query as { session_id?: string };
  if (!session_id) return res.status(400).json({ error: "session_id is required" });
  const rows = db
    .prepare("SELECT * FROM initiative_entries WHERE session_id = ? ORDER BY id")
    .all(session_id);
  res.json(rows);
});

initiativeEntriesRouter.post("/", (req, res) => {
  const { session_id, entity_type, entity_id, name, dex_modifier, max_hp, current_hp } = req.body as {
    session_id?: number;
    entity_type?: string;
    entity_id?: number;
    name?: string;
    dex_modifier?: number;
    max_hp?: number | null;
    current_hp?: number | null;
  };
  if (!session_id || !name) return res.status(400).json({ error: "session_id and name are required" });
  const info = db
    .prepare(
      `INSERT INTO initiative_entries (session_id, entity_type, entity_id, name, dex_modifier, max_hp, current_hp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(session_id, entity_type ?? null, entity_id ?? null, name, dex_modifier ?? 0, max_hp ?? null, current_hp ?? null);
  res.status(201).json(db.prepare("SELECT * FROM initiative_entries WHERE id = ?").get(info.lastInsertRowid));
});

initiativeEntriesRouter.put("/:id", (req, res) => {
  const { initiative, name, max_hp, current_hp, dead, conditions } = req.body as {
    initiative?: number | null;
    name?: string;
    max_hp?: number | null;
    current_hp?: number | null;
    dead?: boolean;
    conditions?: string[];
  };
  db.prepare(
    `UPDATE initiative_entries SET
       initiative = COALESCE(?, initiative),
       name = COALESCE(?, name),
       max_hp = CASE WHEN ? THEN ? ELSE max_hp END,
       current_hp = CASE WHEN ? THEN ? ELSE current_hp END,
       dead = CASE WHEN ? THEN ? ELSE dead END,
       conditions = CASE WHEN ? THEN ? ELSE conditions END
     WHERE id = ?`
  ).run(
    initiative ?? null,
    name ?? null,
    max_hp !== undefined ? 1 : 0,
    max_hp ?? null,
    current_hp !== undefined ? 1 : 0,
    current_hp ?? null,
    dead !== undefined ? 1 : 0,
    dead ? 1 : 0,
    conditions !== undefined ? 1 : 0,
    conditions ? JSON.stringify(conditions) : null,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM initiative_entries WHERE id = ?").get(req.params.id));
});

initiativeEntriesRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM initiative_entries WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Bulk clear — the "Очистить" button between fights. Query-param scoped
// (not /:id) since it targets every row for a session, not one entry.
initiativeEntriesRouter.delete("/", (req, res) => {
  const { session_id } = req.query as { session_id?: string };
  if (!session_id) return res.status(400).json({ error: "session_id is required" });
  db.prepare("DELETE FROM initiative_entries WHERE session_id = ?").run(session_id);
  res.json({ ok: true });
});
