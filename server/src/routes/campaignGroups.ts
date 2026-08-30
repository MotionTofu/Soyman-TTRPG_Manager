import { Router } from "express";
import { db } from "../db/db";

export const campaignGroupsRouter = Router();

// ─── CRUD ────────────────────────────────────────────────────────────────────

campaignGroupsRouter.get("/", (_req, res) => {
  const groups = db
    .prepare("SELECT * FROM campaign_groups ORDER BY sort_order, name")
    .all();
  res.json(groups);
});

campaignGroupsRouter.post("/", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const existing = db
    .prepare("SELECT id FROM campaign_groups WHERE name = ?")
    .get(name.trim());
  if (existing) {
    res.status(409).json({ error: "group name already exists" });
    return;
  }
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) as mx FROM campaign_groups")
    .get() as { mx: number };
  const result = db
    .prepare("INSERT INTO campaign_groups (name, sort_order) VALUES (?, ?)")
    .run(name.trim(), maxOrder.mx + 1);
  const group = db
    .prepare("SELECT * FROM campaign_groups WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(group);
});

campaignGroupsRouter.put("/:id", (req, res) => {
  const { id } = req.params;
  const { name, sort_order } = req.body;
  const group = db
    .prepare("SELECT * FROM campaign_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  if (name !== undefined) {
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name cannot be empty" });
      return;
    }
    const existing = db
      .prepare("SELECT id FROM campaign_groups WHERE name = ? AND id != ?")
      .get(name.trim(), id);
    if (existing) {
      res.status(409).json({ error: "group name already exists" });
      return;
    }
    db.prepare("UPDATE campaign_groups SET name = ? WHERE id = ?").run(
      name.trim(),
      id
    );
  }
  if (sort_order !== undefined) {
    db.prepare("UPDATE campaign_groups SET sort_order = ? WHERE id = ?").run(
      sort_order,
      id
    );
  }
  const updated = db
    .prepare("SELECT * FROM campaign_groups WHERE id = ?")
    .get(id);
  res.json(updated);
});

campaignGroupsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const group = db
    .prepare("SELECT * FROM campaign_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  db.prepare("DELETE FROM campaign_groups WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ─── Reorder ─────────────────────────────────────────────────────────────────

campaignGroupsRouter.put("/reorder/batch", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const stmt = db.prepare(
    "UPDATE campaign_groups SET sort_order = ? WHERE id = ?"
  );
  const tx = db.transaction(() => {
    ids.forEach((id: number, i: number) => stmt.run(i, id));
  });
  tx();
  res.json({ ok: true });
});

// ─── Members ─────────────────────────────────────────────────────────────────

// GET /:id/members — list campaigns in a group
campaignGroupsRouter.get("/:id/members", (req, res) => {
  const { id } = req.params;
  const rows = db
    .prepare(
      `SELECT c.* FROM campaigns c
       JOIN campaign_group_members m ON m.campaign_id = c.id
       WHERE m.group_id = ?
       ORDER BY c.name`
    )
    .all(id);
  res.json(rows);
});

// POST /:id/members — add campaigns to a group
campaignGroupsRouter.post("/:id/members", (req, res) => {
  const { id } = req.params;
  const { campaignIds } = req.body;
  if (!Array.isArray(campaignIds)) {
    res.status(400).json({ error: "campaignIds array is required" });
    return;
  }
  const group = db.prepare("SELECT id FROM campaign_groups WHERE id = ?").get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO campaign_group_members (group_id, campaign_id) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const cid of campaignIds) stmt.run(id, cid);
  });
  tx();
  res.json({ ok: true });
});

// DELETE /:id/members?campaignIds=1,2,3 — remove campaigns from a group
campaignGroupsRouter.delete("/:id/members", (req, res) => {
  const { id } = req.params;
  const raw = req.query.campaignIds;
  const ids = typeof raw === "string" ? raw.split(",").map(Number) : [];
  if (ids.length === 0) {
    res.status(400).json({ error: "campaignIds query param is required" });
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM campaign_group_members WHERE group_id = ? AND campaign_id IN (${placeholders})`
  ).run(id, ...ids);
  res.json({ ok: true });
});

// GET /by-campaign/:campaignId — groups a campaign belongs to
campaignGroupsRouter.get("/by-campaign/:campaignId", (req, res) => {
  const { campaignId } = req.params;
  const rows = db
    .prepare(
      `SELECT g.* FROM campaign_groups g
       JOIN campaign_group_members m ON m.group_id = g.id
       WHERE m.campaign_id = ?
       ORDER BY g.sort_order, g.name`
    )
    .all(campaignId);
  res.json(rows);
});
