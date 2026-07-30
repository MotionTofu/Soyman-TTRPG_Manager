import { Router } from "express";
import { db } from "../db/db";

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

// Idempotent grant — reveal `target_type:target_id` to `player_id` within `campaign_id`.
visibilityGrantsRouter.post("/", (req, res) => {
  const { campaign_id, player_id, target_type, target_id } = req.body as {
    campaign_id?: number;
    player_id?: number;
    target_type?: string;
    target_id?: number;
  };
  if (!campaign_id || !player_id || !target_type || !target_id) {
    return res.status(400).json({ error: "campaign_id, player_id, target_type and target_id are required" });
  }
  if (!VALID_TARGET_TYPES.has(target_type)) return res.status(400).json({ error: "invalid target_type" });
  db.prepare(
    "INSERT OR IGNORE INTO player_visibility_grants (campaign_id, player_id, target_type, target_id) VALUES (?, ?, ?, ?)"
  ).run(campaign_id, player_id, target_type, target_id);
  res.status(201).json({ ok: true });
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
