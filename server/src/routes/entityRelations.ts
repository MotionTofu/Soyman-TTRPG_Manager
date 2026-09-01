import { Router } from "express";
import { db } from "../db/db";

export const entityRelationsRouter = Router();

// Unified entity types — covers both the original RelationsTab (beings,
// characters, communities) and the former LinkDropZone use cases (settings,
// campaigns, events, sessions, etc.).
const ENTITY_TABLES: Record<string, { table: string; nameCol: string }> = {
  being: { table: "setting_beings", nameCol: "name" },
  character: { table: "characters", nameCol: "character_name" },
  community: { table: "setting_communities", nameCol: "name" },
  compendium_entry: { table: "compendium_entries", nameCol: "name" },
  location: { table: "setting_locations", nameCol: "name" },
  artifact: { table: "artifacts", nameCol: "name" },
  setting: { table: "settings", nameCol: "name" },
  campaign: { table: "campaigns", nameCol: "name" },
  setting_event: { table: "setting_events", nameCol: "title" },
  resource: { table: "resources", nameCol: "name" },
  mastering: { table: "mastering_notes", nameCol: "title" },
  scene: { table: "story_scenes", nameCol: "name" },
  adventure: { table: "story_arcs", nameCol: "name" },
  player: { table: "players", nameCol: "name" },
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
  section: string | null;
  origin: string;
  created_at: string;
}

// GET /entity-relations — outgoing + incoming for an entity, optionally filtered by section.
entityRelationsRouter.get("/", (req, res) => {
  const { entity_type, entity_id, section } = req.query as {
    entity_type?: string; entity_id?: string; section?: string;
  };
  if (!entity_type || !entity_id)
    return res.status(400).json({ error: "entity_type and entity_id are required" });

  const sectionFilter = section ? " AND section = ?" : "";
  const outParams = section ? [entity_type, entity_id, section] : [entity_type, entity_id];
  const inParams = section ? [entity_type, entity_id, section] : [entity_type, entity_id];

  const outgoing = db
    .prepare(`SELECT * FROM entity_relations WHERE from_type = ? AND from_id = ?${sectionFilter} ORDER BY created_at DESC`)
    .all(...outParams) as RelationRow[];
  const incoming = db
    .prepare(`SELECT * FROM entity_relations WHERE to_type = ? AND to_id = ?${sectionFilter} ORDER BY created_at DESC`)
    .all(...inParams) as RelationRow[];

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

/**
 * Названия отношений, которые уже где-то заведены, — словарь для подсказки
 * при вводе.
 */
entityRelationsRouter.get("/labels", (req, res) => {
  const { q } = req.query as { q?: string };
  const rows = db
    .prepare("SELECT label FROM entity_relations WHERE TRIM(label) <> ''")
    .all() as { label: string }[];

  const prefix = (q ?? "").trim().toLocaleLowerCase();
  const byWord = new Map<string, { label: string; uses: number }>();
  for (const row of rows) {
    const label = row.label.trim();
    const key = label.toLocaleLowerCase();
    if (prefix && !key.startsWith(prefix)) continue;
    const found = byWord.get(key);
    if (found) found.uses++;
    else byWord.set(key, { label, uses: 1 });
  }
  res.json(
    [...byWord.values()]
      .sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label))
      .slice(0, 12)
  );
});

// POST /entity-relations — create a single relation (supports section + origin).
entityRelationsRouter.post("/", (req, res) => {
  const { from_type, from_id, to_type, to_id, tone, label, description, section, origin } = req.body as {
    from_type: string;
    from_id: number;
    to_type: string;
    to_id: number;
    tone?: string;
    label?: string;
    description?: string;
    section?: string;
    origin?: string;
  };
  if (!from_type || !from_id || !to_type || !to_id)
    return res.status(400).json({ error: "from_type, from_id, to_type, to_id are required" });
  if (!ENTITY_TABLES[from_type] || !ENTITY_TABLES[to_type])
    return res.status(400).json({ error: "unsupported entity type" });
  const created = createRelation(
    { from_type, from_id, to_type, to_id },
    tone || "neutral",
    label ?? "",
    description ?? "",
    section ?? null,
    origin ?? "planned"
  );
  res.status(201).json(created ?? { skipped: true });
});

interface RelationEnds {
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
}

/**
 * Одна связь. Повтор — та же пара в ту же сторону с тем же label и section — не
 * заводится второй раз.
 */
function createRelation(
  ends: RelationEnds,
  tone: string,
  label: string,
  description: string,
  section: string | null = null,
  origin: string = "planned"
) {
  const duplicate = db
    .prepare(
      `SELECT id FROM entity_relations
       WHERE from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND label = ?
       AND (section = ? OR (section IS NULL AND ? IS NULL))`
    )
    .get(ends.from_type, ends.from_id, ends.to_type, ends.to_id, label, section, section);
  if (duplicate) return null;
  const info = db
    .prepare(
      `INSERT INTO entity_relations (from_type, from_id, to_type, to_id, tone, label, description, section, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ends.from_type, ends.from_id, ends.to_type, ends.to_id, tone, label, description, section, origin);
  return db.prepare("SELECT * FROM entity_relations WHERE id = ?").get(info.lastInsertRowid);
}

// POST /entity-relations/batch — batch-create with one tone/label.
entityRelationsRouter.post("/batch", (req, res) => {
  const { entity_type, entity_id, targets, direction, tone, label, description, mirror, section, origin } =
    req.body as {
      entity_type: string;
      entity_id: number;
      targets: { type: string; id: number }[];
      direction?: "outgoing" | "incoming";
      tone?: string;
      label?: string;
      description?: string;
      mirror?: boolean;
      section?: string;
      origin?: string;
    };
  if (!entity_type || !entity_id || !Array.isArray(targets) || targets.length === 0)
    return res.status(400).json({ error: "entity_type, entity_id and targets are required" });
  if (!ENTITY_TABLES[entity_type]) return res.status(400).json({ error: "unsupported entity type" });

  let created = 0;
  let skipped = 0;
  for (const target of targets) {
    if (!ENTITY_TABLES[target.type]) continue;
    const outgoing: RelationEnds = {
      from_type: entity_type,
      from_id: entity_id,
      to_type: target.type,
      to_id: target.id,
    };
    const incoming: RelationEnds = {
      from_type: target.type,
      from_id: target.id,
      to_type: entity_type,
      to_id: entity_id,
    };
    const primary = direction === "incoming" ? incoming : outgoing;
    const ends = mirror ? [primary, direction === "incoming" ? outgoing : incoming] : [primary];
    for (const e of ends) {
      if (e.from_type === e.to_type && e.from_id === e.to_id) continue;
      if (createRelation(e, tone || "neutral", label ?? "", description ?? "", section ?? null, origin ?? "planned")) created++;
      else skipped++;
    }
  }
  res.status(201).json({ created, skipped });
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
