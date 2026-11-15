import { db } from "../db/db";

export function searchId(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export const SCOPED_RESOURCE = `(
  (@campaign IS NOT NULL AND (r.campaign_id = @campaign OR r.session_id IN
      (SELECT id FROM sessions WHERE campaign_id = @campaign AND archived_at IS NULL)))
  OR (r.campaign_id IS NULL AND r.session_id IS NULL AND
      (r.setting_id = @setting OR EXISTS (SELECT 1 FROM resource_setting_links l
        WHERE l.owner_type = 'resource' AND l.owner_id = r.id AND l.setting_id = @setting)
       OR (r.scope = 'system' AND r.system_id IN (SELECT value FROM json_each(@systems)))))
)`;

const scopeSources: Record<string, string> = {
  campaign: `SELECT id FROM campaigns WHERE id = @campaign OR (@campaign IS NULL AND setting_id = @setting)`,
  setting: `SELECT id FROM settings WHERE id = @setting`,
  player: `SELECT player_id AS id FROM campaign_roster WHERE campaign_id = @campaign`,
  character: `SELECT id FROM characters WHERE campaign_id = @campaign`,
  session: `SELECT id FROM sessions WHERE campaign_id = @campaign`,
  location: `SELECT id FROM setting_locations WHERE setting_id = @setting`,
  being: `SELECT id FROM setting_beings WHERE setting_id = @setting`,
  community: `SELECT id FROM setting_communities WHERE setting_id = @setting`,
  artifact: `SELECT id FROM artifacts WHERE setting_id = @setting`,
  setting_event: `SELECT id FROM setting_calendar_events WHERE setting_id = @setting`,
  resource: `SELECT r.id FROM resources r WHERE ${SCOPED_RESOURCE}`,
};

export function readSearchScope(campaign: number | null, selectedSetting: number | null) {
  const campaignRow = campaign == null ? undefined : db.prepare(
    "SELECT setting_id, system_id FROM campaigns WHERE id = ? AND archived_at IS NULL",
  ).get(campaign) as { setting_id: number | null; system_id: number | null } | undefined;
  if (campaign !== null && !campaignRow) return null;
  const setting = campaign !== null ? campaignRow!.setting_id : selectedSetting;
  const systemIds = campaign !== null
    ? (campaignRow!.system_id == null ? [] : [campaignRow!.system_id])
    : (db.prepare(
      "SELECT DISTINCT system_id FROM campaigns WHERE setting_id = ? AND archived_at IS NULL AND system_id IS NOT NULL",
    ).all(setting) as { system_id: number }[]).map(row => row.system_id);
  const params = { campaign, setting, systems: JSON.stringify(systemIds) };
  const allowed = new Map<string, Set<number>>();
  return {
    params,
    includes(type: string, id: number, systemId?: number) {
      if (type === "scene" || type === "adventure") return true; // Selected with effective versions in SQL.
      if (type === "compendium_entry") return systemId !== undefined && systemIds.includes(systemId);
      const sql = scopeSources[type];
      if (!sql) return false;
      let ids = allowed.get(type);
      if (!ids) {
        ids = new Set((db.prepare(sql).all(params) as { id: number }[]).map(row => row.id));
        allowed.set(type, ids);
      }
      return ids.has(id);
    },
  };
}
