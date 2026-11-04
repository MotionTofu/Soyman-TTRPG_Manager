import { db } from "../db/db";
import { SESSION_NUMBER_SQL } from "./sessionNumber";

/**
 * Срок напоминания игрокам — «к сессии №N» (гриллинг В4, 2026-11-04).
 *
 * Хранится только ссылка на сессию; номер и дата считаются при чтении, потому
 * что номер нигде не хранится и пересчитывается, когда сессию убирают в архив
 * (бывшая №20 становится №19). Поэтому и подмена — при чтении, а не записью в
 * момент архивации: сессия в архиве → срок у следующей по дате, а вернули её
 * из архива — напоминание снова при ней, ничего не переписано.
 *
 * Истекает только по отметке «проведена» (Q7), не по прошедшей дате.
 */
export interface ReminderDue {
  session_id: number;
  number: number;
  date: string;
  expired: boolean;
}

interface SessionRow { id: number; campaign_id: number; date: string; status: string; archived_at: string | null }

export function reminderDue(sessionId: number | null | undefined): ReminderDue | null {
  if (sessionId == null) return null;
  const own = db
    .prepare("SELECT id, campaign_id, date, status, archived_at FROM sessions WHERE id = ?")
    .get(sessionId) as SessionRow | undefined;
  if (!own) return null;
  const live = own.archived_at == null && own.status !== "cancelled";
  const target = live
    ? own
    : (db
        .prepare(
          `SELECT id FROM sessions
            WHERE campaign_id = ? AND archived_at IS NULL AND status <> 'cancelled'
              AND (date > ? OR (date = ? AND id > ?))
            ORDER BY date, id LIMIT 1`
        )
        .get(own.campaign_id, own.date, own.date, own.id) as { id: number } | undefined);
  // Следующей нет — срок снимается, напоминание висит «без срока» (Q3).
  if (!target) return null;
  const row = db
    .prepare(`SELECT s.id, s.date, s.status, ${SESSION_NUMBER_SQL} AS number FROM sessions s WHERE s.id = ?`)
    .get(target.id) as { id: number; date: string; status: string; number: number };
  return { session_id: row.id, number: row.number, date: row.date, expired: row.status === "held" };
}

/** Строкам напоминаний — вычисленный срок для Мастера (истёкшие остаются, Q1). */
export function withDue<T extends { due_session_id?: number | null }>(rows: T[]): (T & { due: ReminderDue | null })[] {
  return rows.map((r) => ({ ...r, due: reminderDue(r.due_session_id) }));
}

/** То же для игрока: истёкшее у него пропадает (Q1). */
export function forPlayer<T extends { due_session_id?: number | null }>(rows: T[]) {
  return withDue(rows).filter((r) => !r.due?.expired);
}

/**
 * Срок при создании: только запланированная живая сессия; для напоминания
 * кампании — сессия этой же кампании. Пусто — «без срока».
 */
export function parseDueSession(raw: unknown, campaignId?: number): number | null | "invalid" {
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id)) return "invalid";
  const s = db
    .prepare("SELECT campaign_id FROM sessions WHERE id = ? AND status = 'planned' AND archived_at IS NULL")
    .get(id) as { campaign_id: number } | undefined;
  if (!s || (campaignId != null && s.campaign_id !== campaignId)) return "invalid";
  return id;
}
