import { Router } from "express";
import { db } from "../db/db";
import { ENTITY_KINDS } from "../db/entityKinds";
import { entityNames, refKey } from "../services/entityNames";
import { graphCache } from "./links";

export const entityRelationsRouter = Router();

// Unified entity types — covers both the original RelationsTab (beings,
// characters, communities) and the former LinkDropZone use cases (settings,
// campaigns, events, sessions, etc.).
/**
 * Из каких видов Мастер вправе создать отношение. Фасет `relationCreatable`
 * в реестре: он уже, чем «вид встречается концом в базе», и специально —
 * в `entity_relations` живут строки семнадцати видов, а предлагать в
 * интерфейсе нужно четырнадцать.
 *
 * Таблицы и колонки имён отсюда ушли в реестр, а сам резолв имени — в
 * services/entityNames.ts: этот файл держал шестую по счёту копию одного и
 * того же, включая пакетный вариант, который теперь общий.
 */
const RELATION_KINDS: ReadonlySet<string> = new Set(
  ENTITY_KINDS.filter((k) => k.relationCreatable).map((k) => k.kind)
);

const VALID_TONES = new Set(["positive", "negative", "neutral", "mixed"]);

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

  const allPairs: { type: string; id: number }[] = [];
  for (const r of outgoing) allPairs.push({ type: r.to_type, id: r.to_id });
  for (const r of incoming) allPairs.push({ type: r.from_type, id: r.from_id });
  const nameMap = entityNames(allPairs.map((p) => ({ kind: p.type, id: p.id })));
  const withNames = (rows: RelationRow[], otherKey: "to" | "from") =>
    rows.map((r) => {
      const ot = otherKey === "to" ? r.to_type : r.from_type;
      const oi = otherKey === "to" ? r.to_id : r.from_id;
      return {
        ...r,
        other_type: ot,
        other_id: oi,
        other_name: nameMap.get(refKey(ot, oi)) ?? null,
      };
    });

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
  const prefix = (q ?? "").trim();
  if (!prefix) {
    const rows = db
      .prepare(
        `SELECT label as label, COUNT(*) as uses FROM entity_relations WHERE TRIM(label) <> '' GROUP BY lower(label) ORDER BY uses DESC, label ASC LIMIT 12`
      )
      .all() as { label: string; uses: number }[];
    // keep first-cased variant
    const seen = new Map<string, { label: string; uses: number }>();
    for (const r of rows) {
      const key = r.label.trim().toLocaleLowerCase();
      if (!seen.has(key)) seen.set(key, { label: r.label.trim(), uses: r.uses });
    }
    res.json([...seen.values()]);
    return;
  }
  const rows = db
    .prepare(
      `SELECT label as label, COUNT(*) as uses FROM entity_relations WHERE TRIM(label) <> '' AND lower(label) LIKE lower(?) || '%' GROUP BY lower(label) ORDER BY uses DESC, label ASC LIMIT 12`
    )
    .all(prefix) as { label: string; uses: number }[];
  const seen = new Map<string, { label: string; uses: number }>();
  for (const r of rows) {
    const key = r.label.trim().toLocaleLowerCase();
    if (!seen.has(key)) seen.set(key, { label: r.label.trim(), uses: r.uses });
  }
  res.json([...seen.values()]);
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
  if (!RELATION_KINDS.has(from_type) || !RELATION_KINDS.has(to_type))
    return res.status(400).json({ error: "unsupported entity type" });
  if (tone && !VALID_TONES.has(tone)) return res.status(400).json({ error: "invalid tone" });
  const created = createRelation(
    { from_type, from_id, to_type, to_id },
    tone || "neutral",
    label ?? "",
    description ?? "",
    section ?? null,
    origin ?? "planned"
  );
  graphCache.clear();
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
  if (!RELATION_KINDS.has(entity_type)) return res.status(400).json({ error: "unsupported entity type" });
  if (tone && !VALID_TONES.has(tone)) return res.status(400).json({ error: "invalid tone" });

  let created = 0;
  let skipped = 0;
  const batchTx = db.transaction(() => {
    for (const target of targets) {
      if (!RELATION_KINDS.has(target.type)) continue;
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
  });
  batchTx();
  res.status(201).json({ created, skipped });
  graphCache.clear();
});

entityRelationsRouter.put("/:id", (req, res) => {
  const { tone, label, description } = req.body as {
    tone?: string;
    label?: string;
    description?: string;
  };
  if (tone && !VALID_TONES.has(tone)) return res.status(400).json({ error: "invalid tone" });
  db.prepare(
    `UPDATE entity_relations SET
       tone = COALESCE(?, tone), label = COALESCE(?, label), description = COALESCE(?, description)
     WHERE id = ?`
  ).run(tone ?? null, label ?? null, description ?? null, req.params.id);
  res.json(db.prepare("SELECT * FROM entity_relations WHERE id = ?").get(req.params.id));
  graphCache.clear();
});

entityRelationsRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM entity_relations WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
  graphCache.clear();
});
