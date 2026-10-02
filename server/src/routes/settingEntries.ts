import { Router } from "express";
import { db } from "../db/db";
import { isEntryCategory, parseEntryFields, serializeEntryFields } from "../services/settingWorld";

// Лёгкие записи «Мира» (разбор профиля сеттинга, Q3/Q10/Q11/Q19): вид записи
// — category, поля вида — JSON-колонка fields, «видно игрокам» — флажок.
// «Задумки» (category = notes) игрокам не видны никогда.
export const settingEntriesRouter = Router();

type Row = { id: number; category: string; fields: unknown; visible_to_players: number };

function withFields(row: Row) {
  return { ...row, fields: parseEntryFields(row.category, row.fields) };
}

function one(id: number | bigint | string) {
  const row = db.prepare("SELECT * FROM setting_entries WHERE id = ?").get(id) as Row | undefined;
  return row ? withFields(row) : null;
}

settingEntriesRouter.get("/", (req, res) => {
  const { setting_id, category } = req.query as { setting_id?: string; category?: string };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  // Без category — все записи сеттинга: «Мир» группирует их сам.
  const rows = (
    category
      ? db.prepare("SELECT * FROM setting_entries WHERE setting_id = ? AND category = ? ORDER BY created_at, id").all(setting_id, category)
      : db.prepare("SELECT * FROM setting_entries WHERE setting_id = ? ORDER BY created_at, id").all(setting_id)
  ) as Row[];
  res.json(rows.map(withFields));
});

settingEntriesRouter.post("/", (req, res) => {
  const { setting_id, category, title, content, fields, visible_to_players } = req.body as {
    setting_id: number;
    category: string;
    title?: string;
    content?: string;
    fields?: unknown;
    visible_to_players?: boolean;
  };
  if (!setting_id || !isEntryCategory(category))
    return res.status(400).json({ error: "setting_id and a known category are required" });
  const visible = category !== "notes" && !!visible_to_players ? 1 : 0;
  const info = db
    .prepare(
      "INSERT INTO setting_entries (setting_id, category, title, content, fields, visible_to_players) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(setting_id, category, title ?? "", content ?? "", serializeEntryFields(category, fields), visible);
  res.status(201).json(one(info.lastInsertRowid));
});

settingEntriesRouter.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM setting_entries WHERE id = ?").get(req.params.id) as Row | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { title, content, fields, visible_to_players, category } = req.body as {
    title?: string;
    content?: string;
    fields?: unknown;
    visible_to_players?: boolean;
    category?: string;
  };
  if (category !== undefined && !isEntryCategory(category))
    return res.status(400).json({ error: "unknown category" });
  // «В мир ›» (Q19): задумка меняет вид; поля чужого вида отбрасываются.
  const nextCategory = category ?? existing.category;
  const nextFields =
    fields !== undefined
      ? serializeEntryFields(nextCategory, fields)
      : category !== undefined
        ? serializeEntryFields(nextCategory, parseEntryFields(existing.category, existing.fields))
        : null;
  const visible =
    nextCategory === "notes" ? 0 : visible_to_players === undefined ? null : visible_to_players ? 1 : 0;
  db.prepare(
    `UPDATE setting_entries SET
       title = COALESCE(?, title),
       content = COALESCE(?, content),
       category = ?,
       fields = COALESCE(?, fields),
       visible_to_players = COALESCE(?, visible_to_players)
     WHERE id = ?`
  ).run(title ?? null, content ?? null, nextCategory, nextFields, visible, req.params.id);
  res.json(one(req.params.id));
});

settingEntriesRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM setting_entries WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
