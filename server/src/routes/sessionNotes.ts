import { Router } from "express";
import { db } from "../db/db";
import { SESSION_NUMBER_SQL } from "../services/sessionNumber";
import { idOfUid, scanMentions } from "../services/mentions";
import { graphCache } from "./links";

// Лента сессии и статус «идёт» (гриллинг 2026-09-28).
//
// Лента заменила текст «Основных событий»: Мастер пишет по ходу игры
// сообщениями, каждое — строка session_notes. Смена сцены в ленте — не
// сообщение, а разделитель; его время берётся из журнала запусков
// (session_scenes.launched_at), поэтому он отдаётся здесь же.
//
// Идёт одна сессия на всё приложение: чат в правой панели пишет в неё с любой
// страницы, и цель у него должна быть одна.

export const sessionNotesRouter = Router();

interface NoteRow {
  id: number;
  session_id: number;
  text: string;
  inworld_date: string | null;
  created_at: string;
  updated_at: string;
}

const LIVE_MODES = ["live"] as const;

/**
 * Упоминания сессии пересобираются целиком из задумки и всех сообщений ленты.
 * Разностью «было/стало» по одному тексту их не посчитать: NPC, упомянутый в
 * двух сообщениях, после правки одного остался бы без ссылки.
 */
export function syncSessionMentions(sessionId: number): void {
  const session = db.prepare("SELECT idea_notes FROM sessions WHERE id = ?").get(sessionId) as
    | { idea_notes: string | null }
    | undefined;
  if (!session) return;
  const notes = db.prepare("SELECT text FROM session_notes WHERE session_id = ?").all(sessionId) as { text: string }[];
  const targets = new Map<string, { type: string; id: number }>();
  for (const text of [session.idea_notes ?? "", ...notes.map((n) => n.text)]) {
    for (const m of scanMentions(text)) {
      const id = m.kind === "ref" ? idOfUid(m.type, m.uid) : m.id;
      if (id != null) targets.set(`${m.type}:${id}`, { type: m.type, id });
    }
  }
  const existing = db
    .prepare("SELECT id, to_type, to_id FROM generic_links WHERE from_type = 'session' AND from_id = ? AND section = 'mention'")
    .all(sessionId) as { id: number; to_type: string; to_id: number }[];
  const del = db.prepare("DELETE FROM generic_links WHERE id = ?");
  const add = db.prepare(
    "INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section) VALUES ('session', ?, ?, ?, 'mention')"
  );
  db.transaction(() => {
    for (const l of existing) {
      if (!targets.delete(`${l.to_type}:${l.to_id}`)) del.run(l.id);
    }
    for (const t of targets.values()) add.run(sessionId, t.type, t.id);
  })();
  graphCache.clear();
}

/** Дата в мире на момент записи: конец отрезка, если «прошёл день» жали, иначе начало. */
function inworldDateOf(sessionId: number): string | null {
  const s = db
    .prepare(
      "SELECT inworld_year y, inworld_month m, inworld_day d, inworld_year_end ye, inworld_month_end me, inworld_day_end de FROM sessions WHERE id = ?"
    )
    .get(sessionId) as { y: number | null; m: number | null; d: number | null; ye: number | null; me: number | null; de: number | null } | undefined;
  if (!s) return null;
  if (s.ye != null && s.me != null && s.de != null) return `${s.ye}-${s.me}-${s.de}`;
  if (s.y != null && s.m != null && s.d != null) return `${s.y}-${s.m}-${s.d}`;
  return null;
}

function liveSession() {
  return (
    db
      .prepare(
        `SELECT s.id, s.campaign_id, c.name AS campaign_name, c.setting_id, s.title, s.date, s.live_mode,
                ${SESSION_NUMBER_SQL} AS session_number
         FROM sessions s JOIN campaigns c ON c.id = s.campaign_id
         WHERE s.live_mode IS NOT NULL AND s.archived_at IS NULL
         ORDER BY s.id DESC LIMIT 1`
      )
      .get() ?? null
  );
}

sessionNotesRouter.get("/live", (_req, res) => {
  res.json(liveSession());
});

// «Начать» — mode: 'live'; «Завершить» — mode: null, и сессия становится
// проведённой. Вторая идущая сессия без replace — 409 с той, что идёт: Мастеру
// показывают вопрос «завершить её?» (Q46).
sessionNotesRouter.post("/:id/live", (req, res) => {
  const sessionId = Number(req.params.id);
  const { mode, replace } = (req.body ?? {}) as { mode?: string | null; replace?: boolean };
  const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  if (!session) return res.status(404).json({ error: "not found" });
  if (mode == null) {
    db.prepare("UPDATE sessions SET live_mode = NULL, status = 'held' WHERE id = ?").run(sessionId);
    return res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId));
  }
  if (!LIVE_MODES.includes(mode as (typeof LIVE_MODES)[number])) {
    return res.status(400).json({ error: "mode must be live|null" });
  }
  const other = db
    .prepare("SELECT id FROM sessions WHERE live_mode IS NOT NULL AND id <> ? AND archived_at IS NULL")
    .all(sessionId) as { id: number }[];
  if (other.length && !replace) return res.status(409).json({ error: "another session is live", live: liveSession() });
  db.transaction(() => {
    // Завершённая чужая — проведена: её «Завершить» Мастер и подтвердил.
    for (const o of other) db.prepare("UPDATE sessions SET live_mode = NULL, status = 'held' WHERE id = ?").run(o.id);
    db.prepare("UPDATE sessions SET live_mode = ? WHERE id = ?").run(mode, sessionId);
  })();
  res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId));
});

sessionNotesRouter.get("/:id/notes", (req, res) => {
  const sessionId = Number(req.params.id);
  const notes = db.prepare("SELECT * FROM session_notes WHERE session_id = ? ORDER BY created_at, id").all(sessionId);
  const scenes = db
    .prepare(
      `SELECT j.id, j.launched_at, COALESCE(lib.name, s.name) AS name
       FROM session_scenes j
       JOIN story_scenes s ON s.id = j.scene_id
       LEFT JOIN story_scenes lib ON lib.id = s.library_scene_id
       WHERE j.session_id = ? ORDER BY j.id`
    )
    .all(sessionId);
  res.json({ notes, scenes });
});

// created_at и inworld_date принимаются только ради «Отменить» после
// удаления: вернувшееся сообщение встаёт на своё место в ленте.
sessionNotesRouter.post("/:id/notes", (req, res) => {
  const sessionId = Number(req.params.id);
  const { text, created_at, inworld_date } = (req.body ?? {}) as {
    text?: string;
    created_at?: string;
    inworld_date?: string | null;
  };
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });
  if (!db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sessionId)) return res.status(404).json({ error: "not found" });
  const restoring = typeof created_at === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(created_at);
  const info = restoring
    ? db
        .prepare("INSERT INTO session_notes (session_id, text, inworld_date, created_at) VALUES (?, ?, ?, ?)")
        .run(sessionId, text, inworld_date ?? null, created_at)
    : db
        .prepare("INSERT INTO session_notes (session_id, text, inworld_date) VALUES (?, ?, ?)")
        .run(sessionId, text, inworldDateOf(sessionId));
  syncSessionMentions(sessionId);
  res.status(201).json(db.prepare("SELECT * FROM session_notes WHERE id = ?").get(info.lastInsertRowid));
});

sessionNotesRouter.put("/notes/:noteId", (req, res) => {
  const { text } = (req.body ?? {}) as { text?: string };
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });
  const note = db.prepare("SELECT * FROM session_notes WHERE id = ?").get(req.params.noteId) as NoteRow | undefined;
  if (!note) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE session_notes SET text = ?, updated_at = datetime('now') WHERE id = ?").run(text, note.id);
  syncSessionMentions(note.session_id);
  res.json(db.prepare("SELECT * FROM session_notes WHERE id = ?").get(note.id));
});

sessionNotesRouter.delete("/notes/:noteId", (req, res) => {
  const note = db.prepare("SELECT * FROM session_notes WHERE id = ?").get(req.params.noteId) as NoteRow | undefined;
  if (!note) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM session_notes WHERE id = ?").run(note.id);
  syncSessionMentions(note.session_id);
  res.json(note);
});
