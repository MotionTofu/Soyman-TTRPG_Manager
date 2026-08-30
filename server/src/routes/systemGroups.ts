import { Router } from "express";
import { db } from "../db/db";

export const systemGroupsRouter = Router();

// ─── CRUD ────────────────────────────────────────────────────────────────────

systemGroupsRouter.get("/", (_req, res) => {
  const groups = db
    .prepare("SELECT * FROM system_groups ORDER BY sort_order, name")
    .all();
  res.json(groups);
});

systemGroupsRouter.post("/", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const existing = db
    .prepare("SELECT id FROM system_groups WHERE name = ?")
    .get(name.trim());
  if (existing) {
    res.status(409).json({ error: "group name already exists" });
    return;
  }
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) as mx FROM system_groups")
    .get() as { mx: number };
  const result = db
    .prepare("INSERT INTO system_groups (name, sort_order) VALUES (?, ?)")
    .run(name.trim(), maxOrder.mx + 1);
  const group = db
    .prepare("SELECT * FROM system_groups WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(group);
});

systemGroupsRouter.put("/:id", (req, res) => {
  const { id } = req.params;
  const { name, sort_order } = req.body;
  const group = db
    .prepare("SELECT * FROM system_groups WHERE id = ?")
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
      .prepare("SELECT id FROM system_groups WHERE name = ? AND id != ?")
      .get(name.trim(), id);
    if (existing) {
      res.status(409).json({ error: "group name already exists" });
      return;
    }
    db.prepare("UPDATE system_groups SET name = ? WHERE id = ?").run(
      name.trim(),
      id
    );
  }
  if (sort_order !== undefined) {
    db.prepare("UPDATE system_groups SET sort_order = ? WHERE id = ?").run(
      sort_order,
      id
    );
  }
  const updated = db
    .prepare("SELECT * FROM system_groups WHERE id = ?")
    .get(id);
  res.json(updated);
});

systemGroupsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const group = db
    .prepare("SELECT * FROM system_groups WHERE id = ?")
    .get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  db.prepare("DELETE FROM system_groups WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ─── Reorder ─────────────────────────────────────────────────────────────────

systemGroupsRouter.put("/reorder/batch", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const stmt = db.prepare(
    "UPDATE system_groups SET sort_order = ? WHERE id = ?"
  );
  const tx = db.transaction(() => {
    ids.forEach((id: number, i: number) => stmt.run(i, id));
  });
  tx();
  res.json({ ok: true });
});

// ─── Members ─────────────────────────────────────────────────────────────────

// GET /:id/members — list systems in a group
systemGroupsRouter.get("/:id/members", (req, res) => {
  const { id } = req.params;
  const rows = db
    .prepare(
      `SELECT s.* FROM systems s
       JOIN system_group_members m ON m.system_id = s.id
       WHERE m.group_id = ?
       ORDER BY s.name`
    )
    .all(id);
  res.json(rows);
});

// POST /:id/members — add systems to a group
systemGroupsRouter.post("/:id/members", (req, res) => {
  const { id } = req.params;
  const { systemIds } = req.body;
  if (!Array.isArray(systemIds)) {
    res.status(400).json({ error: "systemIds array is required" });
    return;
  }
  const group = db.prepare("SELECT id FROM system_groups WHERE id = ?").get(id);
  if (!group) {
    res.status(404).json({ error: "group not found" });
    return;
  }
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO system_group_members (group_id, system_id) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const sid of systemIds) stmt.run(id, sid);
  });
  tx();
  res.json({ ok: true });
});

// DELETE /:id/members?systemIds=1,2,3 — remove systems from a group
systemGroupsRouter.delete("/:id/members", (req, res) => {
  const { id } = req.params;
  const raw = req.query.systemIds;
  const ids = typeof raw === "string" ? raw.split(",").map(Number) : [];
  if (ids.length === 0) {
    res.status(400).json({ error: "systemIds query param is required" });
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM system_group_members WHERE group_id = ? AND system_id IN (${placeholders})`
  ).run(id, ...ids);
  res.json({ ok: true });
});

// GET /by-system/:systemId — groups a system belongs to
systemGroupsRouter.get("/by-system/:systemId", (req, res) => {
  const { systemId } = req.params;
  const rows = db
    .prepare(
      `SELECT g.* FROM system_groups g
       JOIN system_group_members m ON m.group_id = g.id
       WHERE m.system_id = ?
       ORDER BY g.sort_order, g.name`
    )
    .all(systemId);
  res.json(rows);
});
