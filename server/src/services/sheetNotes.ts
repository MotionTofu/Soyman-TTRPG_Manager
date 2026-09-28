import { db } from "../db/db";
import { SESSION_NUMBER_SQL } from "./sessionNumber";

// Заметки игрока на листе (гриллинг 2026-09-28, Q8–Q11, Q20–Q26). Это
// записи его дневника (world_exploration_entries) от персонажа, у каждой —
// своя сессия. Колонка листа показывает их лентой с разделителями сессий.

export interface NoteSession {
  id: number;
  session_number: number;
  title: string | null;
  date: string;
  /** Мастер нажал «Начать»: в шапке колонки «идёт», а не «после». */
  live: boolean;
}

const SESSION_COLS = `s.id, ${SESSION_NUMBER_SQL} AS session_number, s.title, s.date, (s.live_mode = 'live') AS live`;

/**
 * Куда встаёт новая заметка (Q10, Q47): идущая сессия кампании, иначе
 * запланированная на сегодня, иначе последняя проведённая. Прогон — не
 * идущая: игроки его не видят (Q44).
 */
export function noteSessionFor(campaignId: number): NoteSession | null {
  const pick = (where: string, order: string) =>
    db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions s WHERE s.campaign_id = ? AND s.archived_at IS NULL AND ${where} ORDER BY ${order} LIMIT 1`)
      .get(campaignId) as (Omit<NoteSession, "live"> & { live: number | null }) | undefined;
  const row =
    pick("s.live_mode = 'live'", "s.id DESC") ??
    pick("s.status = 'planned' AND s.date = date('now', 'localtime')", "s.id DESC") ??
    pick("s.status = 'held'", "s.date DESC, s.id DESC");
  return row ? { ...row, live: !!row.live } : null;
}

export interface SheetNotes {
  campaign_id: number;
  target: NoteSession | null;
  sessions: Omit<NoteSession, "live">[];
  entries: { id: number; session_id: number | null; name: string; description: string; created_at: string }[];
}

/** Колонка листа: цель новой заметки, сессии для разделителей, записи персонажа. */
export function sheetNotes(characterId: number): SheetNotes | null {
  const character = db.prepare("SELECT campaign_id FROM characters WHERE id = ?").get(characterId) as
    | { campaign_id: number | null }
    | undefined;
  if (!character?.campaign_id) return null;
  const campaignId = character.campaign_id;
  const entries = db
    .prepare(
      `SELECT id, session_id, name, description, created_at FROM world_exploration_entries
       WHERE character_id = ? AND campaign_id = ? AND session_id IS NOT NULL AND archived_at IS NULL
       ORDER BY created_at, id`
    )
    .all(characterId, campaignId) as SheetNotes["entries"];
  const ids = [...new Set(entries.map((e) => e.session_id).filter((id): id is number => id != null))];
  const sessions = ids.length
    ? (db
        .prepare(
          `SELECT s.id, ${SESSION_NUMBER_SQL} AS session_number, s.title, s.date FROM sessions s
           WHERE s.id IN (${ids.map(() => "?").join(",")})`
        )
        .all(...ids) as SheetNotes["sessions"])
    : [];
  return { campaign_id: campaignId, target: noteSessionFor(campaignId), sessions, entries };
}
