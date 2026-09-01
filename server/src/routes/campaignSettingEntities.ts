import { Router } from "express";
import { db } from "../db/db";

// Manages which setting entities are *included* in a campaign's "Для игроков"
// panel.  Inclusion is separate from per-player visibility: an entity must
// first be included here before any player_visibility_grants take effect.
export const campaignSettingEntitiesRouter = Router();

const VALID_ENTITY_TYPES = new Set([
  "setting_location",
  "setting_being",
  "setting_community",
  "setting_calendar_event",
]);

// List included entities for a campaign, optionally filtered by entity_type.
campaignSettingEntitiesRouter.get("/:campaignId", (req, res) => {
  const campaignId = Number(req.params.campaignId);
  if (!campaignId) return res.status(400).json({ error: "campaignId is required" });
  const { entity_type } = req.query as { entity_type?: string };
  let sql = "SELECT entity_type, entity_id FROM campaign_setting_entities WHERE campaign_id = ?";
  const params: (string | number)[] = [campaignId];
  if (entity_type) {
    if (!VALID_ENTITY_TYPES.has(entity_type)) return res.status(400).json({ error: "invalid entity_type" });
    sql += " AND entity_type = ?";
    params.push(entity_type);
  }
  res.json(db.prepare(sql).all(...params));
});

// Add a single entity to a campaign's player panel.
campaignSettingEntitiesRouter.post("/:campaignId", (req, res) => {
  const campaignId = Number(req.params.campaignId);
  const { entity_type, entity_id } = req.body as { entity_type?: string; entity_id?: number };
  if (!campaignId || !entity_type || !entity_id) {
    return res.status(400).json({ error: "campaignId, entity_type and entity_id are required" });
  }
  if (!VALID_ENTITY_TYPES.has(entity_type)) return res.status(400).json({ error: "invalid entity_type" });
  db.prepare(
    "INSERT OR IGNORE INTO campaign_setting_entities (campaign_id, entity_type, entity_id) VALUES (?, ?, ?)"
  ).run(campaignId, entity_type, entity_id);
  res.status(201).json({ ok: true });
});

// Remove a single entity from a campaign's player panel.
campaignSettingEntitiesRouter.delete("/:campaignId", (req, res) => {
  const campaignId = Number(req.params.campaignId);
  const { entity_type, entity_id } = req.query as { entity_type?: string; entity_id?: string };
  if (!campaignId || !entity_type || !entity_id) {
    return res.status(400).json({ error: "campaignId, entity_type and entity_id are required" });
  }
  if (!VALID_ENTITY_TYPES.has(entity_type)) return res.status(400).json({ error: "invalid entity_type" });
  db.prepare(
    "DELETE FROM campaign_setting_entities WHERE campaign_id = ? AND entity_type = ? AND entity_id = ?"
  ).run(campaignId, entity_type, Number(entity_id));
  res.json({ ok: true });
});

// Batch add/remove entities. Body: { entities[], action: "add" | "remove" }.
// Each entity is { entity_type, entity_id }.
campaignSettingEntitiesRouter.post("/:campaignId/batch", (req, res) => {
  const campaignId = Number(req.params.campaignId);
  const { entities, action } = req.body as {
    entities?: { entity_type: string; entity_id: number }[];
    action?: string;
  };
  if (!campaignId || !entities?.length || !action) {
    return res.status(400).json({ error: "campaignId, entities[] and action are required" });
  }
  if (action !== "add" && action !== "remove") {
    return res.status(400).json({ error: "action must be 'add' or 'remove'" });
  }
  for (const e of entities) {
    if (!VALID_ENTITY_TYPES.has(e.entity_type)) {
      return res.status(400).json({ error: `invalid entity_type: ${e.entity_type}` });
    }
  }
  const insert = db.prepare(
    "INSERT OR IGNORE INTO campaign_setting_entities (campaign_id, entity_type, entity_id) VALUES (?, ?, ?)"
  );
  const del = db.prepare(
    "DELETE FROM campaign_setting_entities WHERE campaign_id = ? AND entity_type = ? AND entity_id = ?"
  );
  const runBatch = db.transaction(() => {
    let affected = 0;
    for (const e of entities) {
      if (action === "add") {
        insert.run(campaignId, e.entity_type, e.entity_id);
      } else {
        del.run(campaignId, e.entity_type, e.entity_id);
        // Also clean up any visibility grants for removed entities
        db.prepare(
          "DELETE FROM player_visibility_grants WHERE campaign_id = ? AND target_type = ? AND target_id = ?"
        ).run(campaignId, e.entity_type, e.entity_id);
      }
      affected++;
    }
    return affected;
  });
  const affected = runBatch();
  res.status(201).json({ ok: true, affected });
});
