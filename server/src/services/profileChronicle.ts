import { db } from "../db/db";
import { ENTITY_KINDS } from "../db/entityKinds";

const PROFILE_TYPES = new Set(["being", "location", "community", "artifact"]);

/** Только чтение существующей модели. Участник — явная связь, упоминание само по себе им не становится. */
export function profileChronicle(type: string, id: number, campaignId: number | null) {
  const table = PROFILE_TYPES.has(type) ? ENTITY_KINDS.find((k) => k.kind === type)?.table : undefined;
  if (!table) return null;
  const owner = db.prepare(`SELECT setting_id FROM ${table} WHERE id = ? AND archived_at IS NULL`).get(id) as { setting_id: number } | undefined;
  if (!owner) return null;
  const campaign = campaignId == null ? null : db.prepare("SELECT * FROM campaigns WHERE id = ? AND setting_id = ? AND archived_at IS NULL").get(campaignId, owner.setting_id) as { pinned_calendar_year: number | null; pinned_calendar_month: number | null } | undefined;
  if (campaignId != null && !campaign) return null;
  const setting = db.prepare("SELECT pinned_calendar_year, pinned_calendar_month FROM settings WHERE id = ?").get(owner.setting_id) as { pinned_calendar_year: number | null; pinned_calendar_month: number | null };
  const clock = campaign ?? setting;
  let now: { year: number; month: number; day?: number } | null = clock.pinned_calendar_year != null && clock.pinned_calendar_month != null ? { year: clock.pinned_calendar_year, month: clock.pinned_calendar_month } : null;
  let source = now ? "закреплённый месяц" : "";
  if (!now && campaignId != null) {
    const last = db.prepare(`SELECT COALESCE(inworld_year_end,inworld_year) AS year, COALESCE(inworld_month_end,inworld_month,1) AS month,
      COALESCE(inworld_day_end,inworld_day) AS day FROM sessions WHERE campaign_id = ? AND status = 'held' AND archived_at IS NULL AND inworld_year IS NOT NULL
      ORDER BY COALESCE(inworld_year_end,inworld_year) DESC, COALESCE(inworld_month_end,inworld_month,1) DESC, COALESCE(inworld_day_end,inworld_day,1) DESC, id DESC LIMIT 1`).get(campaignId) as { year: number; month: number; day: number } | undefined;
    if (last) { now = last; source = "по последней сессии"; }
  }
  const linkedIds = (kind: string) => db.prepare(`SELECT to_id AS id FROM generic_links WHERE from_type = ? AND from_id = ? AND to_type = ? AND COALESCE(section,'') != 'mention'
    UNION SELECT from_id FROM generic_links WHERE to_type = ? AND to_id = ? AND from_type = ? AND COALESCE(section,'') != 'mention'
    UNION SELECT to_id FROM entity_relations WHERE from_type = ? AND from_id = ? AND to_type = ?
    UNION SELECT from_id FROM entity_relations WHERE to_type = ? AND to_id = ? AND from_type = ?`).all(type,id,kind,type,id,kind,type,id,kind,type,id,kind) as { id: number }[];
  const read = (kind: "setting_event" | "campaign_event") => {
    const ids = linkedIds(kind).map((r) => r.id);
    if (!ids.length) return [];
    const marks = ids.map(() => "?").join(",");
    return kind === "setting_event"
      ? db.prepare(`SELECT e.*, 'setting' AS source FROM setting_calendar_events e WHERE e.id IN (${marks}) AND e.setting_id = ?`).all(...ids,owner.setting_id)
      : db.prepare(`SELECT e.*, 'campaign' AS source FROM campaign_calendar_events e JOIN campaigns c ON c.id = e.campaign_id
          WHERE e.id IN (${marks}) AND c.setting_id = ? AND c.archived_at IS NULL AND (? IS NULL OR c.id = ?)`).all(...ids,owner.setting_id,campaignId,campaignId);
  };
  const world = read("setting_event") as { id: number }[];
  // Кампания может скрыть событие своего сеттинга в собственной Хронике.
  const hidden = campaignId == null ? new Set<number>() : new Set((db.prepare("SELECT event_id FROM campaign_hidden_events WHERE campaign_id = ?").all(campaignId) as { event_id: number }[]).map((r) => r.event_id));
  return { events: [...world.filter((e) => !hidden.has(e.id)), ...read("campaign_event")], now, source };
}
