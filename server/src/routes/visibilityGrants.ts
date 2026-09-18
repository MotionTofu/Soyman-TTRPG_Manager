import { Router } from "express";
import { db } from "../db/db";
import { isAccessLevel } from "../services/accessLevel";
import { getFlaggedSettingContent, getPlayerSectionsFor, getSettingPlayerContent } from "../services/playerContent";

// Per-player, per-campaign reveal grants backing the "Для игроков" tabs on
// campaign and setting profiles (see schema.sql comment on
// player_visibility_grants). A grant on a campaign_player_section or
// setting_calendar_event/setting_location/setting_being/setting_community
// target reveals it to that one player in that one campaign; adding content
// elsewhere never grants anything by itself.
export const visibilityGrantsRouter = Router();

const VALID_TARGET_TYPES = new Set([
  "campaign_player_section",
  "campaign_player_article",
  "setting_location",
  "setting_being",
  "setting_community",
  "setting_calendar_event",
]);

// Ступень выдачи — см. services/accessLevel.ts (там же normalizeAccessLevel:
// неизвестное читается как 'open'). Локальный предикат для валидации тел.
function validAccessLevel(value: unknown): boolean {
  return isAccessLevel(value);
}

// List grants for a campaign, optionally narrowed to one target (used by the
// GM UI to render which players currently see a given piece of content) or
// one player (used to render a player's full grant matrix).
visibilityGrantsRouter.get("/", (req, res) => {
  const { campaign_id, target_type, target_id, player_id } = req.query as {
    campaign_id?: string;
    target_type?: string;
    target_id?: string;
    player_id?: string;
  };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  let sql = "SELECT * FROM player_visibility_grants WHERE campaign_id = ?";
  const params: (string | number)[] = [campaign_id];
  if (target_type) {
    sql += " AND target_type = ?";
    params.push(target_type);
  }
  if (target_id) {
    sql += " AND target_id = ?";
    params.push(target_id);
  }
  if (player_id) {
    sql += " AND player_id = ?";
    params.push(player_id);
  }
  res.json(db.prepare(sql).all(...params));
});

// «Глазами игрока» (Кабинет игрока, 2026-09-12, шаг 3): что видит этот игрок
// в этой кампании. Считается ТЕМ ЖЕ кодом, что и выдача игроку
// (services/playerContent.ts — те же функции кормят /player/*), а не своим
// способом: превью со своим расчётом врало бы ровно тогда, когда нужно, —
// при раздаче доступов. Ручка мастерская (за гейтом ролей игрокам закрыта);
// чужой кампании здесь не бывает — игрок обязан быть в ростере кампании.
visibilityGrantsRouter.get("/preview", (req, res) => {
  const campaignId = Number(req.query.campaign_id);
  const playerId = Number(req.query.player_id);
  if (!Number.isFinite(campaignId) || !Number.isFinite(playerId)) {
    return res.status(400).json({ error: "campaign_id and player_id are required" });
  }
  const campaign = db.prepare("SELECT id, setting_id FROM campaigns WHERE id = ?").get(campaignId) as
    | { id: number; setting_id: number | null }
    | undefined;
  if (!campaign) return res.status(404).json({ error: "not found" });
  const member = db
    .prepare("SELECT 1 FROM campaign_roster WHERE campaign_id = ? AND player_id = ?")
    .get(campaignId, playerId);
  if (!member) return res.status(404).json({ error: "not found" });
  res.json({
    setting: getSettingPlayerContent(campaignId, playerId),
    sections: getPlayerSectionsFor(campaignId, playerId),
    flagged: getFlaggedSettingContent(campaign.setting_id),
  });
});

// Idempotent grant — reveal `target_type:target_id` to `player_id` within `campaign_id`.
//
// `access_level` — ступень выдачи. Без неё поведение прежнее: существующий
// грант не трогается (INSERT OR IGNORE), новый встаёт как 'open'. С явно
// переданной ступенью грант выставляется в неё (upsert): иначе смену ступени
// пришлось бы делать парой revoke+grant, а между ними игрок видел бы дыру.
visibilityGrantsRouter.post("/", (req, res) => {
  const { campaign_id, player_id, target_type, target_id, access_level } = req.body as {
    campaign_id?: number;
    player_id?: number;
    target_type?: string;
    target_id?: number;
    access_level?: string;
  };
  if (!campaign_id || !player_id || !target_type || !target_id) {
    return res.status(400).json({ error: "campaign_id, player_id, target_type and target_id are required" });
  }
  if (!VALID_TARGET_TYPES.has(target_type)) return res.status(400).json({ error: "invalid target_type" });
  if (access_level === undefined) {
    db.prepare(
      "INSERT OR IGNORE INTO player_visibility_grants (campaign_id, player_id, target_type, target_id) VALUES (?, ?, ?, ?)"
    ).run(campaign_id, player_id, target_type, target_id);
  } else {
    if (!validAccessLevel(access_level)) return res.status(400).json({ error: "invalid access_level" });
    db.prepare(
      `INSERT INTO player_visibility_grants (campaign_id, player_id, target_type, target_id, access_level)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, player_id, target_type, target_id) DO UPDATE SET access_level = excluded.access_level`
    ).run(campaign_id, player_id, target_type, target_id, access_level);
  }
  res.status(201).json({ ok: true });
});

// Change the access level of an existing grant without revoking it.
visibilityGrantsRouter.put("/", (req, res) => {
  const { campaign_id, player_id, target_type, target_id, access_level } = req.body as {
    campaign_id?: number;
    player_id?: number;
    target_type?: string;
    target_id?: number;
    access_level?: string;
  };
  if (!campaign_id || !player_id || !target_type || !target_id || access_level === undefined) {
    return res.status(400).json({ error: "campaign_id, player_id, target_type, target_id and access_level are required" });
  }
  if (!VALID_TARGET_TYPES.has(target_type)) return res.status(400).json({ error: "invalid target_type" });
  if (!validAccessLevel(access_level)) return res.status(400).json({ error: "invalid access_level" });
  const info = db.prepare(
    "UPDATE player_visibility_grants SET access_level = ? WHERE campaign_id = ? AND player_id = ? AND target_type = ? AND target_id = ?"
  ).run(access_level, campaign_id, player_id, target_type, target_id);
  if (info.changes === 0) return res.status(404).json({ error: "grant not found" });
  res.json({ ok: true });
});

// Revoke — same key shape as POST, but as a DELETE with a query string since
// there's no natural single-row id the caller already has on hand.
visibilityGrantsRouter.delete("/", (req, res) => {
  const { campaign_id, player_id, target_type, target_id } = req.query as {
    campaign_id?: string;
    player_id?: string;
    target_type?: string;
    target_id?: string;
  };
  if (!campaign_id || !player_id || !target_type || !target_id) {
    return res.status(400).json({ error: "campaign_id, player_id, target_type and target_id are required" });
  }
  db.prepare(
    "DELETE FROM player_visibility_grants WHERE campaign_id = ? AND player_id = ? AND target_type = ? AND target_id = ?"
  ).run(campaign_id, player_id, target_type, target_id);
  res.json({ ok: true });
});

// Batch grant/revoke — set visibility for multiple targets × multiple players
// in a single transaction. Body: { campaign_id, player_ids[], targets[],
// action: "grant" | "revoke", access_level? }. Each target is { target_type,
// target_id }. `access_level` — только с action "grant": выставляет ступень
// (upsert), без неё — прежний INSERT OR IGNORE.
visibilityGrantsRouter.post("/batch", (req, res) => {
  const { campaign_id, player_ids, targets, action, access_level } = req.body as {
    campaign_id?: number;
    player_ids?: number[];
    targets?: { target_type: string; target_id: number }[];
    action?: string;
    access_level?: string;
  };
  if (!campaign_id || !player_ids?.length || !targets?.length || !action) {
    return res.status(400).json({ error: "campaign_id, player_ids[], targets[], action are required" });
  }
  if (action !== "grant" && action !== "revoke") {
    return res.status(400).json({ error: "action must be 'grant' or 'revoke'" });
  }
  for (const t of targets) {
    if (!VALID_TARGET_TYPES.has(t.target_type)) {
      return res.status(400).json({ error: `invalid target_type: ${t.target_type}` });
    }
  }
  if (access_level !== undefined && action === "grant" && !validAccessLevel(access_level)) {
    return res.status(400).json({ error: "invalid access_level" });
  }
  const insert = db.prepare(
    "INSERT OR IGNORE INTO player_visibility_grants (campaign_id, player_id, target_type, target_id) VALUES (?, ?, ?, ?)"
  );
  const upsert = db.prepare(
    `INSERT INTO player_visibility_grants (campaign_id, player_id, target_type, target_id, access_level)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, player_id, target_type, target_id) DO UPDATE SET access_level = excluded.access_level`
  );
  const del = db.prepare(
    "DELETE FROM player_visibility_grants WHERE campaign_id = ? AND player_id = ? AND target_type = ? AND target_id = ?"
  );
  const runBatch = db.transaction(() => {
    let affected = 0;
    for (const playerId of player_ids) {
      for (const t of targets) {
        if (action === "grant") {
          if (access_level !== undefined) upsert.run(campaign_id, playerId, t.target_type, t.target_id, access_level);
          else insert.run(campaign_id, playerId, t.target_type, t.target_id);
        } else {
          del.run(campaign_id, playerId, t.target_type, t.target_id);
        }
        affected++;
      }
    }
    return affected;
  });
  const affected = runBatch();
  res.status(201).json({ ok: true, affected });
});
