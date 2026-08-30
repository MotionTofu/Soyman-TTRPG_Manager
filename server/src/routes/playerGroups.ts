import { Router } from "express";
import { db } from "../db/db";

export const playerGroupsRouter = Router();

// ─── CRUD ────────────────────────────────────────────────────────────────────

playerGroupsRouter.get("/", (_req, res) => {
  const groups = db
    .prepare("SELECT * FROM player_groups ORDER BY sort_order, name")
    .all();
  res.json(groups);
});

playerGroupsRouter.post("/", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const existing = db
    .prepare("SELECT id FROM player_groups WHERE name = ?")
    .get(name.trim());
  if (existing) {
    res.status(409).json({ error: "group name already exists" });
    return;
  }
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) as mx FROM player_groups")
    .get() as { mx: number };
  const result = db
    .prepare("INSERT INTO player_groups (name, sort_order) VALUES (?, ?)")
    .run(name.trim(), maxOrder.mx + 1);
  const group = db
    .prepare("SELECT * FROM player_groups WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(group);
});

playerGroupsRouter.put("/:id", (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const group = db
    .prepare("SELECT * FROM player_groups WHERE id = ?")
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
      .prepare("SELECT id FROM player_groups WHERE name = ? AND id != ?")
      .get(name.trim(), id);
    if (existing) {
      res.status(409).json({ error: "group name already exists" });
      return;
    }
    db.prepare("UPDATE player_groups SET name = ? WHERE id = ?").run(
      name.trim(),
      id
    );
  }
  const updated = db
    .prepare("SELECT * FROM player_groups WHERE id = ?")
    .get(id);
  res.json(updated);
});

playerGroupsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const group = db
    .prepare("SELECT * FROM player_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  db.prepare("DELETE FROM player_groups WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ─── Members ─────────────────────────────────────────────────────────────────

playerGroupsRouter.get("/:id/members", (req, res) => {
  const { id } = req.params;
  const group = db
    .prepare("SELECT * FROM player_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  const members = db
    .prepare(
      `SELECT p.* FROM players p
       JOIN player_group_members m ON p.id = m.player_id
       WHERE m.group_id = ?
       ORDER BY p.name`
    )
    .all(id);
  res.json(members);
});

playerGroupsRouter.post("/:id/members", (req, res) => {
  const { id } = req.params;
  const { playerIds } = req.body;
  if (!Array.isArray(playerIds)) {
    res.status(400).json({ error: "playerIds array is required" });
    return;
  }
  const group = db
    .prepare("SELECT * FROM player_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO player_group_members (group_id, player_id) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const pid of playerIds) {
      stmt.run(id, pid);
    }
  });
  tx();
  const members = db
    .prepare(
      `SELECT p.* FROM players p
       JOIN player_group_members m ON p.id = m.player_id
       WHERE m.group_id = ?
       ORDER BY p.name`
    )
    .all(id);
  res.json(members);
});

playerGroupsRouter.delete("/:id/members", (req, res) => {
  const { id } = req.params;
  const raw = req.query.playerIds;
  if (!raw || typeof raw !== "string") {
    res.status(400).json({ error: "playerIds query param is required (comma-separated)" });
    return;
  }
  const playerIds = raw.split(",").map(Number).filter(Boolean);
  if (playerIds.length === 0) {
    res.status(400).json({ error: "playerIds must contain at least one id" });
    return;
  }
  const group = db
    .prepare("SELECT * FROM player_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  const stmt = db.prepare(
    "DELETE FROM player_group_members WHERE group_id = ? AND player_id = ?"
  );
  const tx = db.transaction(() => {
    for (const pid of playerIds) {
      stmt.run(id, pid);
    }
  });
  tx();
  const members = db
    .prepare(
      `SELECT p.* FROM players p
       JOIN player_group_members m ON p.id = m.player_id
       WHERE m.group_id = ?
       ORDER BY p.name`
    )
    .all(id);
  res.json(members);
});

// ─── Groups for a specific player ────────────────────────────────────────────

playerGroupsRouter.get("/by-player/:playerId", (req, res) => {
  const { playerId } = req.params;
  const groups = db
    .prepare(
      `SELECT g.* FROM player_groups g
       JOIN player_group_members m ON g.id = m.group_id
       WHERE m.player_id = ?
       ORDER BY g.sort_order, g.name`
    )
    .all(playerId);
  res.json(groups);
});
