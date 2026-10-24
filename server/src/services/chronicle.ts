import { db } from "../db/db";
import { SESSION_NUMBER_SQL } from "./sessionNumber";

/** Связь сессии с ходом мира; не смешивается с участниками события. */
export const SESSION_EVENTS_SECTION = "session_events";
export type ChronicleEventKind = "setting_event" | "campaign_event";

export interface ChronicleSession {
  id: number;
  event_id: number;
  link_id: number;
  campaign_id: number;
  title: string | null;
  date: string;
  status: string;
  session_number: number;
}

export function eventSessions(kind: ChronicleEventKind, eventId?: number, campaignId?: number): ChronicleSession[] {
  return db.prepare(`SELECT s.id, s.campaign_id, s.title, s.date, s.status,
      ${SESSION_NUMBER_SQL} AS session_number, gl.to_id AS event_id, gl.id AS link_id
    FROM generic_links gl JOIN sessions s ON s.id = gl.from_id
    WHERE gl.from_type = 'session' AND gl.to_type = ? AND gl.section = ?
      AND s.archived_at IS NULL
      AND (? IS NULL OR gl.to_id = ?) AND (? IS NULL OR s.campaign_id = ?)
    ORDER BY s.date, s.id`).all(kind, SESSION_EVENTS_SECTION, eventId ?? null, eventId ?? null,
      campaignId ?? null, campaignId ?? null) as ChronicleSession[];
}

/** Одна выборка связей на список, а не запрос к каждому событию. */
export function withEventSessions<T extends { id: number }>(rows: T[], kind: ChronicleEventKind, campaignId?: number) {
  const byEvent = new Map<number, ChronicleSession[]>();
  for (const session of eventSessions(kind, undefined, campaignId)) {
    const list = byEvent.get(session.event_id) ?? [];
    list.push(session);
    byEvent.set(session.event_id, list);
  }
  return rows.map((row) => ({ ...row, sessions: byEvent.get(row.id) ?? [] }));
}

export function sessionEvents(sessionId: number) {
  const session = db.prepare("SELECT campaign_id FROM sessions WHERE id = ? AND archived_at IS NULL")
    .get(sessionId) as { campaign_id: number } | undefined;
  if (!session) return null;
  const own = db.prepare(`SELECT e.*, 'campaign' AS source, gl.id AS link_id FROM generic_links gl
    JOIN campaign_calendar_events e ON e.id = gl.to_id AND e.campaign_id = ?
    WHERE gl.from_type = 'session' AND gl.from_id = ? AND gl.to_type = 'campaign_event' AND gl.section = ?`)
    .all(session.campaign_id, sessionId, SESSION_EVENTS_SECTION);
  const world = db.prepare(`SELECT e.*, 'setting' AS source, gl.id AS link_id FROM generic_links gl
    JOIN setting_calendar_events e ON e.id = gl.to_id
    JOIN campaigns c ON c.id = ? AND c.setting_id = e.setting_id
    WHERE gl.from_type = 'session' AND gl.from_id = ? AND gl.to_type = 'setting_event' AND gl.section = ?`)
    .all(session.campaign_id, sessionId, SESSION_EVENTS_SECTION);
  return [...own, ...world];
}

/** Обе стороны должны существовать и принадлежать одной кампании/её сеттингу. */
export function sessionEventLinkError(body: Record<string, unknown>): string | null {
  if (body.section !== SESSION_EVENTS_SECTION) return null;
  if (body.from_type !== "session" || !["campaign_event", "setting_event"].includes(String(body.to_type)))
    return "Нужна связь сессии с событием мира";
  const session = db.prepare(`SELECT s.campaign_id, c.setting_id FROM sessions s
    JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ? AND s.archived_at IS NULL`)
    .get(Number(body.from_id)) as { campaign_id: number; setting_id: number | null } | undefined;
  if (!session) return "Сессия не найдена";
  const event = body.to_type === "campaign_event"
    ? db.prepare("SELECT 1 FROM campaign_calendar_events WHERE id = ? AND campaign_id = ?")
      .get(Number(body.to_id), session.campaign_id)
    : db.prepare("SELECT 1 FROM setting_calendar_events WHERE id = ? AND setting_id = ?")
      .get(Number(body.to_id), session.setting_id);
  return event ? null : "Событие не принадлежит кампании или её сеттингу";
}

// Ключи сервер проверяет без цветов. Тоны и подписи — только клиентская
// cyclePointPalette.ts; здесь намеренно лишь допустимые значения API.
const CYCLE_POINT_COLORS = new Set(["ochre", "green", "blue", "slate", "plum", "red", "brown", "ink", "moss"]);
export function validCyclePointColor(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && CYCLE_POINT_COLORS.has(value));
}
