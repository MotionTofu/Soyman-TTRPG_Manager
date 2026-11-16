import { Router } from "express";
import { db } from "../db/db";
import { isEntryCategory, normalizeRelatedEntryIds, parseEntryFields, parseRelatedEntryIds, serializeEntryFields } from "../services/settingWorld";

// Лёгкие записи «Мира» (разбор профиля сеттинга, Q3/Q10/Q11/Q19): вид записи
// — category, поля вида — JSON-колонка fields, «видно игрокам» — флажок.
// «Задумки» (category = notes) игрокам не видны никогда.
export const settingEntriesRouter = Router();

type Row = { id: number; setting_id: number; category: string; fields: unknown; visible_to_players: number };

function linkTargets(settingId: number | string): Set<number> {
  const rows = db.prepare("SELECT id FROM setting_entries WHERE setting_id = ? AND category <> 'notes'").all(settingId) as { id: number }[];
  return new Set(rows.map(({ id }) => id));
}

function relatedInSetting(ids: number[], targets: ReadonlySet<number>, ownId?: number) {
  return ids.filter((id) => id !== ownId && targets.has(id));
}

function withFields(row: Row, targets: ReadonlySet<number>) {
  return {
    ...row,
    fields: parseEntryFields(row.category, row.fields),
    related_entry_ids: row.category === "notes" ? [] : relatedInSetting(parseRelatedEntryIds(row.fields), targets, row.id),
  };
}

function one(id: number | bigint | string) {
  const row = db.prepare("SELECT * FROM setting_entries WHERE id = ?").get(id) as Row | undefined;
  return row ? withFields(row, linkTargets(row.setting_id)) : null;
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
  const targets = category ? linkTargets(setting_id) : new Set(rows.filter((row) => row.category !== "notes").map((row) => row.id));
  res.json(rows.map((row) => withFields(row, targets)));
});

settingEntriesRouter.post("/", (req, res) => {
  const { setting_id, category, title, content, fields, visible_to_players, related_entry_ids } = req.body as {
    setting_id: number;
    category: string;
    title?: string;
    content?: string;
    fields?: unknown;
    related_entry_ids?: unknown;
    visible_to_players?: boolean;
  };
  if (!setting_id || !isEntryCategory(category))
    return res.status(400).json({ error: "setting_id and a known category are required" });
  const visible = category !== "notes" && !!visible_to_players ? 1 : 0;
  const related = category !== "notes" && Array.isArray(related_entry_ids) && related_entry_ids.length
    ? relatedInSetting(normalizeRelatedEntryIds(related_entry_ids), linkTargets(setting_id))
    : [];
  const info = db
    .prepare(
      "INSERT INTO setting_entries (setting_id, category, title, content, fields, visible_to_players) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(setting_id, category, title ?? "", content ?? "", serializeEntryFields(category, fields, related), visible);
  res.status(201).json(one(info.lastInsertRowid));
});

settingEntriesRouter.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM setting_entries WHERE id = ?").get(req.params.id) as Row | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { title, content, fields, visible_to_players, category, related_entry_ids } = req.body as {
    title?: string;
    content?: string;
    fields?: unknown;
    related_entry_ids?: unknown;
    visible_to_players?: boolean;
    category?: string;
  };
  if (category !== undefined && !isEntryCategory(category))
    return res.status(400).json({ error: "unknown category" });
  // «В мир ›» (Q19): задумка меняет вид; поля чужого вида отбрасываются.
  const nextCategory = category ?? existing.category;
  let nextFields: string | null = null;
  if (fields !== undefined || category !== undefined || related_entry_ids !== undefined) {
    const related = nextCategory === "notes" ? [] : relatedInSetting(
      related_entry_ids === undefined ? parseRelatedEntryIds(existing.fields) : normalizeRelatedEntryIds(related_entry_ids),
      linkTargets(existing.setting_id),
      existing.id,
    );
    nextFields = serializeEntryFields(
      nextCategory,
      fields === undefined ? parseEntryFields(existing.category, existing.fields) : fields,
      related,
    );
  }
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
