import { Router } from "express";
import { db } from "../db/db";

export const settingsGroupsRouter = Router();

// ─── CRUD ────────────────────────────────────────────────────────────────────

settingsGroupsRouter.get("/", (_req, res) => {
  const groups = db
    .prepare("SELECT * FROM setting_groups ORDER BY sort_order, name")
    .all();
  res.json(groups);
});

settingsGroupsRouter.post("/", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const existing = db
    .prepare("SELECT id FROM setting_groups WHERE name = ?")
    .get(name.trim());
  if (existing) {
    res.status(409).json({ error: "group name already exists" });
    return;
  }
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) as mx FROM setting_groups")
    .get() as { mx: number };
  const result = db
    .prepare("INSERT INTO setting_groups (name, sort_order) VALUES (?, ?)")
    .run(name.trim(), maxOrder.mx + 1);
  const group = db
    .prepare("SELECT * FROM setting_groups WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(group);
});

settingsGroupsRouter.put("/:id", (req, res) => {
  const { id } = req.params;
  const { name, sort_order } = req.body;
  const group = db
    .prepare("SELECT * FROM setting_groups WHERE id = ?")
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
      .prepare("SELECT id FROM setting_groups WHERE name = ? AND id != ?")
      .get(name.trim(), id);
    if (existing) {
      res.status(409).json({ error: "group name already exists" });
      return;
    }
    db.prepare("UPDATE setting_groups SET name = ? WHERE id = ?").run(
      name.trim(),
      id
    );
  }
  if (sort_order !== undefined) {
    db.prepare("UPDATE setting_groups SET sort_order = ? WHERE id = ?").run(
      sort_order,
      id
    );
  }
  const updated = db
    .prepare("SELECT * FROM setting_groups WHERE id = ?")
    .get(id);
  res.json(updated);
});

settingsGroupsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const group = db
    .prepare("SELECT * FROM setting_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  db.prepare("DELETE FROM setting_groups WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ─── Reorder ─────────────────────────────────────────────────────────────────

settingsGroupsRouter.put("/reorder/batch", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const stmt = db.prepare(
    "UPDATE setting_groups SET sort_order = ? WHERE id = ?"
  );
  const tx = db.transaction(() => {
    ids.forEach((id: number, index: number) => {
      stmt.run(index, id);
    });
  });
  tx();
  const groups = db
    .prepare("SELECT * FROM setting_groups ORDER BY sort_order, name")
    .all();
  res.json(groups);
});

// ─── Members ─────────────────────────────────────────────────────────────────

settingsGroupsRouter.get("/:id/members", (req, res) => {
  const { id } = req.params;
  const group = db
    .prepare("SELECT * FROM setting_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  const members = db
    .prepare(
      `SELECT s.* FROM settings s
       JOIN setting_group_members m ON s.id = m.setting_id
       WHERE m.group_id = ?
       ORDER BY s.name`
    )
    .all(id);
  res.json(members);
});

settingsGroupsRouter.post("/:id/members", (req, res) => {
  const { id } = req.params;
  const { settingIds } = req.body;
  if (!Array.isArray(settingIds)) {
    res.status(400).json({ error: "settingIds array is required" });
    return;
  }
  const group = db
    .prepare("SELECT * FROM setting_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO setting_group_members (group_id, setting_id) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const sid of settingIds) {
      stmt.run(id, sid);
    }
  });
  tx();
  // Возвращаем обновлённый список участников, чтобы клиент не делал лишний запрос
  const members = db
    .prepare(
      `SELECT s.* FROM settings s
       JOIN setting_group_members m ON s.id = m.setting_id
       WHERE m.group_id = ?
       ORDER BY s.name`
    )
    .all(id);
  res.json(members);
});

settingsGroupsRouter.delete("/:id/members", (req, res) => {
  const { id } = req.params;
  const raw = req.query.settingIds;
  if (!raw || typeof raw !== "string") {
    res.status(400).json({ error: "settingIds query param is required (comma-separated)" });
    return;
  }
  const settingIds = raw.split(",").map(Number).filter(Boolean);
  if (settingIds.length === 0) {
    res.status(400).json({ error: "settingIds must contain at least one id" });
    return;
  }
  const group = db
    .prepare("SELECT * FROM setting_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  const stmt = db.prepare(
    "DELETE FROM setting_group_members WHERE group_id = ? AND setting_id = ?"
  );
  const tx = db.transaction(() => {
    for (const sid of settingIds) {
      stmt.run(id, sid);
    }
  });
  tx();
  const members = db
    .prepare(
      `SELECT s.* FROM settings s
       JOIN setting_group_members m ON s.id = m.setting_id
       WHERE m.group_id = ?
       ORDER BY s.name`
    )
    .all(id);
  res.json(members);
});

// ─── Groups for a specific setting ───────────────────────────────────────────

settingsGroupsRouter.get("/by-setting/:settingId", (req, res) => {
  const { settingId } = req.params;
  const groups = db
    .prepare(
      `SELECT g.* FROM setting_groups g
       JOIN setting_group_members m ON g.id = m.group_id
       WHERE m.setting_id = ?
       ORDER BY g.sort_order, g.name`
    )
    .all(settingId);
  res.json(groups);
});
