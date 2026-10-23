import { campaignEntityState, isCampaignEntityKind, type CampaignEntityState } from "@soyman/shared";
import { db } from "../db/db";
import { refKey } from "./entityNames";

/** JSON ссылки: при смене состояния сохраняются и остальные ключи. */
export function campaignParticipationData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export interface WorldRecordDetails {
  state: CampaignEntityState;
  summary: { text: string; from_setting: boolean } | null;
  /** Подписи граф живут в словаре клиента; текст нужен только для state. */
  aspects: { key: string; text: string | null }[];
  changed_at: string;
}

/** Два запроса на кампанию, без отдельного запроса записей для каждой строки. */
export function campaignWorldDetails(campaignId: number): Map<string, WorldRecordDetails> {
  const links = db.prepare(
    "SELECT entity_type, entity_id, data, created_at FROM participations WHERE context_type = 'campaign' AND context_id = ?"
  ).all(campaignId) as { entity_type: string; entity_id: number; data: string; created_at: string }[];
  const details = new Map<string, WorldRecordDetails>();
  for (const link of links) {
    if (!isCampaignEntityKind(link.entity_type)) continue;
    details.set(refKey(link.entity_type, link.entity_id), {
      state: campaignEntityState(link.entity_type, campaignParticipationData(link.data).state),
      summary: null,
      aspects: [],
      changed_at: link.created_at,
    });
  }
  const rows = db.prepare(
    `SELECT r.owner_type, r.owner_id, r.aspect, r.text, r.updated_at
       FROM entity_records r
       WHERE r.campaign_id = ? AND r.status NOT IN ('draft','discarded')
         AND NOT EXISTS (SELECT 1 FROM entity_records n WHERE n.replaces_id = r.id)
       ORDER BY r.updated_at DESC, r.id DESC`
  ).all(campaignId) as { owner_type: string; owner_id: number; aspect: string; text: string; updated_at: string }[];
  for (const row of rows) {
    const detail = details.get(refKey(row.owner_type, row.owner_id));
    if (!detail) continue;
    if (!detail.summary) {
      detail.summary = { text: row.text, from_setting: false };
      detail.changed_at = row.updated_at;
    }
    // Последний текст служебной графы; несколько записей одной графы не дублируют её.
    if (!detail.aspects.some((a) => a.key === row.aspect)) {
      detail.aspects.push({ key: row.aspect, text: row.aspect === "state" ? row.text : null });
    }
  }
  return details;
}

/** Идущая встреча, иначе последняя сыгранная; прогон и будущая не подходят. */
export function campaignStateSession(campaignId: number): number | null {
  const row = db.prepare(
    `SELECT id FROM sessions WHERE campaign_id = ? AND archived_at IS NULL
       AND (live_mode = 'live' OR status = 'held')
     ORDER BY CASE WHEN live_mode = 'live' THEN 1 ELSE 0 END DESC, date DESC, id DESC LIMIT 1`
  ).get(campaignId) as { id: number } | undefined;
  return row?.id ?? null;
}

/** Слухи и черновики — число записей, включая черновики кампании «без адреса». */
export function campaignRecordCounts(campaignId: number): { rumors: number; drafts: number } {
  return db.prepare(
    `SELECT
       COUNT(CASE WHEN r.status NOT IN ('draft','discarded') AND r.certainty = 'rumor' THEN 1 END) AS rumors,
       COUNT(CASE WHEN r.status = 'draft' THEN 1 END) AS drafts
     FROM entity_records r WHERE r.campaign_id = ?
       AND NOT EXISTS (SELECT 1 FROM entity_records n WHERE n.replaces_id = r.id)`
  ).get(campaignId) as { rumors: number; drafts: number };
}
