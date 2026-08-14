import { Router } from "express";
import { db } from "../db/db";

export const entityRelationsRouter = Router();

// Only these participate in typed relations today (beings, player
// characters, factions/communities, and compendium monster templates) — see
// the user's original ask: "личности и фракции". Extending this set later
// just means adding a row here.
const ENTITY_TABLES: Record<string, { table: string; nameCol: string }> = {
  being: { table: "setting_beings", nameCol: "name" },
  character: { table: "characters", nameCol: "character_name" },
  community: { table: "setting_communities", nameCol: "name" },
  compendium_entry: { table: "compendium_entries", nameCol: "name" },
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

/**
 * Названия отношений, которые уже где-то заведены, — словарь для подсказки
 * при вводе. Отдельной таблицы у него нет намеренно: список выводится из
 * самих связей, поэтому не расходится с ними и не копит слова, которые уже
 * нигде не используются. Часто встречающиеся идут первыми — «друзья» из
 * десяти связей нужнее, чем «должен денег за лошадь» из одной.
 */
entityRelationsRouter.get("/labels", (req, res) => {
  const { q } = req.query as { q?: string };
  const rows = db
    .prepare("SELECT label FROM entity_relations WHERE TRIM(label) <> ''")
    .all() as { label: string }[];

  // Регистр сводится здесь, а не запросом: lower() и COLLATE NOCASE в SQLite
  // умеют только латиницу, так что «Дружба» и «дружба» остались бы разными
  // словами, а поиск по «друж» не нашёл бы ни того, ни другого.
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
  const created = createRelation(
    { from_type, from_id, to_type, to_id },
    tone || "neutral",
    label ?? "",
    description ?? ""
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
 * Одна связь. Повтор — та же пара в ту же сторону с тем же названием — не
 * заводится второй раз: пакетное добавление и зеркалирование иначе плодили бы
 * одинаковые строки с одного лишнего нажатия. Возвращает null, если связь уже
 * была: вызывающему это нужно, чтобы посчитать, сколько на самом деле создано.
 */
function createRelation(ends: RelationEnds, tone: string, label: string, description: string) {
  const duplicate = db
    .prepare(
      `SELECT id FROM entity_relations
       WHERE from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND label = ?`
    )
    .get(ends.from_type, ends.from_id, ends.to_type, ends.to_id, label);
  if (duplicate) return null;
  const info = db
    .prepare(
      `INSERT INTO entity_relations (from_type, from_id, to_type, to_id, tone, label, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ends.from_type, ends.from_id, ends.to_type, ends.to_id, tone, label, description);
  return db.prepare("SELECT * FROM entity_relations WHERE id = ?").get(info.lastInsertRowid);
}

/**
 * Пакетное добавление: один тон и одно название на несколько адресатов, с
 * необязательным зеркалом. Зеркало — вторая самостоятельная запись, а не
 * симметричная связь: отношения сторон вправе разойтись, и правится каждая
 * своя. Лор при этом не копируется — он у каждой стороны свой.
 */
entityRelationsRouter.post("/batch", (req, res) => {
  const { entity_type, entity_id, targets, direction, tone, label, description, mirror } =
    req.body as {
      entity_type: string;
      entity_id: number;
      targets: { type: string; id: number }[];
      // outgoing — отношение этой сущности к выбранным, incoming — их к ней.
      direction?: "outgoing" | "incoming";
      tone?: string;
      label?: string;
      description?: string;
      mirror?: boolean;
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
      // Связь сущности с самой собой смысла не имеет и в списках выглядит
      // сломанной — пропускается молча.
      if (e.from_type === e.to_type && e.from_id === e.to_id) continue;
      if (createRelation(e, tone || "neutral", label ?? "", description ?? "")) created++;
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
