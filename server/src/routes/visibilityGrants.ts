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
  // Артефакты (спека campaign-paper, Q40).
  "setting_artifact",
]);

// «Сводка» выдачи (спека campaign-paper, Q30/Q35): что открыто игрокам этой
// кампании, по видам, с именами и списком игроков. Скрытого тут нет.
const SUMMARY_NAMES: Record<string, string> = {
  setting_location: "SELECT name FROM setting_locations WHERE id = ?",
  setting_being: "SELECT name FROM setting_beings WHERE id = ?",
  setting_community: "SELECT name FROM setting_communities WHERE id = ?",
  setting_artifact: "SELECT name FROM artifacts WHERE id = ?",
  setting_calendar_event: "SELECT title AS name FROM setting_calendar_events WHERE id = ?",
  campaign_player_article: "SELECT title AS name FROM campaign_player_articles WHERE id = ?",
  campaign_player_section: "SELECT name FROM campaign_player_sections WHERE id = ?",
};

// Строка «Игрокам: …» на профиле сущности сеттинга (спека campaign-paper,
// Q34): кому она открыта в каждой кампании этого сеттинга.
// «Текст игрокам» — у всех, кроме артефакта (у него своего нет).
const TARGET_SETTING: Record<string, string> = {
  setting_location: "SELECT setting_id, player_text FROM setting_locations WHERE id = ?",
  setting_being: "SELECT setting_id, player_text FROM setting_beings WHERE id = ?",
  setting_community: "SELECT setting_id, player_text FROM setting_communities WHERE id = ?",
  setting_artifact: "SELECT setting_id, NULL AS player_text FROM artifacts WHERE id = ?",
  setting_calendar_event: "SELECT setting_id, player_text FROM setting_calendar_events WHERE id = ?",
};

visibilityGrantsRouter.get("/target", (req, res) => {
  const type = String(req.query.target_type ?? "");
  const id = Number(req.query.target_id);
  const sql = TARGET_SETTING[type];
  if (!sql || !id) return res.status(400).json({ error: "target_type and target_id are required" });
  const owner = db.prepare(sql).get(id) as { setting_id: number; player_text: string | null } | undefined;
  if (!owner) return res.status(404).json({ error: "not found" });
  const campaigns = db
    .prepare("SELECT id, name FROM campaigns WHERE setting_id = ? AND archived_at IS NULL ORDER BY name COLLATE NOCASE")
    .all(owner.setting_id) as { id: number; name: string }[];
  const players = db.prepare(
    `SELECT p.id, p.name FROM player_visibility_grants g JOIN players p ON p.id = g.player_id
      WHERE g.campaign_id = ? AND g.target_type = ? AND g.target_id = ? ORDER BY p.name COLLATE NOCASE`
  );
  const rosterCount = db.prepare("SELECT COUNT(*) AS n FROM campaign_roster WHERE campaign_id = ? AND status != 'left'");
  res.json({
    player_text: owner.player_text,
    campaigns: campaigns.map((c) => {
      const seen = players.all(c.id, type, id) as { id: number; name: string }[];
      const n = (rosterCount.get(c.id) as { n: number }).n;
      return { campaign_id: c.id, campaign_name: c.name, players: seen, all: n > 0 && seen.length >= n };
    }),
  });
});

visibilityGrantsRouter.get("/summary", (req, res) => {
  const campaignId = Number(req.query.campaign_id);
  if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
  const rows = db
    .prepare(
      `SELECT g.target_type, g.target_id, g.player_id, g.access_level, p.name AS player_name
         FROM player_visibility_grants g JOIN players p ON p.id = g.player_id
        WHERE g.campaign_id = ?
        ORDER BY g.target_type, g.target_id, p.name COLLATE NOCASE`
    )
    .all(campaignId) as { target_type: string; target_id: number; player_id: number; access_level: string; player_name: string }[];
  const roster = (
    db.prepare("SELECT player_id FROM campaign_roster WHERE campaign_id = ? AND status != 'left'").all(campaignId) as { player_id: number }[]
  ).map((r) => r.player_id);
  const items = new Map<string, { target_type: string; target_id: number; name: string; players: { id: number; name: string; access_level: string }[] }>();
  for (const r of rows) {
    const key = `${r.target_type}:${r.target_id}`;
    let item = items.get(key);
    if (!item) {
      const sql = SUMMARY_NAMES[r.target_type];
      const named = sql ? (db.prepare(sql).get(r.target_id) as { name: string } | undefined) : undefined;
      if (!named) continue; // цель удалена — висячий грант в сводку не идёт
      item = { target_type: r.target_type, target_id: r.target_id, name: named.name, players: [] };
      items.set(key, item);
    }
    item.players.push({ id: r.player_id, name: r.player_name, access_level: r.access_level });
  }
  res.json(
    [...items.values()]
      .map((i) => ({ ...i, all: roster.length > 0 && roster.every((id) => i.players.some((p) => p.id === id)) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
  );
});

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
    flagged: getFlaggedSettingContent(campaign.setting_id, campaignId),
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
