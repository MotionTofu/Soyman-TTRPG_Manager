import { Router } from "express";
import { db } from "../db/db";

export const entityRelationsRouter = Router();

// Only these three participate in typed relations today (beings, player
// characters, factions/communities) — see the user's original ask: "личности
// и фракции". Extending this set later just means adding a row here.
const ENTITY_TABLES: Record<string, { table: string; nameCol: string }> = {
  being: { table: "setting_beings", nameCol: "name" },
  character: { table: "characters", nameCol: "character_name" },
  community: { table: "setting_communities", nameCol: "name" },
};

function resolveName(type: string, id: number): string | null {
  const def = ENTITY_TABLES[type];
  if (!def) return null;
  const row = db.prepare(`SELECT ${def.nameCol} as name FROM ${def.table} WHERE id = ?`).get(id) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

interface RelationRow {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  tone: string;
  label: string;
  description: string;
  created_at: string;
}

// Relations are directional (A's stated attitude toward B), so a full
// picture of "how does this entity relate to everyone" needs both rows it
// authored (outgoing) and rows others authored about it (incoming) — the
// client renders these as two lists since they can legitimately disagree.
entityRelationsRouter.get("/", (req, res) => {
  const { entity_type, entity_id } = req.query as { entity_type?: string; entity_id?: string };
  if (!entity_type || !entity_id)
    return res.status(400).json({ error: "entity_type and entity_id are required" });

  const outgoing = db
    .prepare("SELECT * FROM entity_relations WHERE from_type = ? AND from_id = ? ORDER BY created_at DESC")
    .all(entity_type, entity_id) as RelationRow[];
  const incoming = db
    .prepare("SELECT * FROM entity_relations WHERE to_type = ? AND to_id = ? ORDER BY created_at DESC")
    .all(entity_type, entity_id) as RelationRow[];

  const withNames = (rows: RelationRow[], otherKey: "to" | "from") =>
    rows.map((r) => ({
      ...r,
      other_type: otherKey === "to" ? r.to_type : r.from_type,
      other_id: otherKey === "to" ? r.to_id : r.from_id,
      other_name: resolveName(otherKey === "to" ? r.to_type : r.from_type, otherKey === "to" ? r.to_id : r.from_id),
    }));

  res.json({
    outgoing: withNames(outgoing, "to"),
    incoming: withNames(incoming, "from"),
  });
});

entityRelationsRouter.post("/", (req, res) => {
  const { from_type, from_id, to_type, to_id, tone, label, description } = req.body as {
    from_type: string;
    from_id: number;
    to_type: string;
    to_id: number;
    tone?: string;
    label?: string;
    description?: string;
  };
  if (!from_type || !from_id || !to_type || !to_id)
    return res.status(400).json({ error: "from_type, from_id, to_type, to_id are required" });
  if (!ENTITY_TABLES[from_type] || !ENTITY_TABLES[to_type])
    return res.status(400).json({ error: "unsupported entity type" });
  const info = db
    .prepare(
      `INSERT INTO entity_relations (from_type, from_id, to_type, to_id, tone, label, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(from_type, from_id, to_type, to_id, tone || "neutral", label ?? "", description ?? "");
  res.status(201).json(db.prepare("SELECT * FROM entity_relations WHERE id = ?").get(info.lastInsertRowid));
});

entityRelationsRouter.put("/:id", (req, res) => {
  const { tone, label, description } = req.body as {
    tone?: string;
    label?: string;
    description?: string;
  };
  db.prepare(
    `UPDATE entity_relations SET
       tone = COALESCE(?, tone), label = COALESCE(?, label), description = COALESCE(?, description)
     WHERE id = ?`
  ).run(tone ?? null, label ?? null, description ?? null, req.params.id);
  res.json(db.prepare("SELECT * FROM entity_relations WHERE id = ?").get(req.params.id));
});

entityRelationsRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM entity_relations WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
