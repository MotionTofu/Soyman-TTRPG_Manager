// Участие — сущность в контексте (гриллинг профилей 2026-10-02, Q16/Q19;
// словарь граф §2, №21). Два контекста:
//
// - приключение: силы (существа и сообщества) с ходом событий — цель, план,
//   без вмешательства, если помочь, если лишить рычага. Участники берутся
//   сами из составов сцен приключения (разъёмы «Сюжетные персонажи» и
//   «Препятствия») плюс добавленные руками закулисные силы;
// - кампания: персонаж игрока — почему здесь, личная ставка, почему сейчас.
//
// Участие существа в кампании по-прежнему живёт на главе «Текущая ситуация»
// (routes/settingBeings) — эта таблица его не дублирует.
//
// Только Мастер: роутер стоит за общим гейтом /api (index.ts).
import { Router } from "express";
import { db } from "../db/db";
import { entityNames, refKey } from "../services/entityNames";
import {
  parseParticipation,
  parsePcParticipation,
  serializeParticipation,
  parseSceneParticipation,
  serializePcParticipation,
} from "../services/beingForce";
import { CAST_SECTIONS } from "../story/cast";

export const participationsRouter = Router();

/** Кто может участвовать в приключении: силы, у которых есть ход событий. */
const ADVENTURE_ENTITY_TYPES = new Set(["being", "community"]);
/** Из каких разъёмов состава сцены участник попадает в приключение сам. */
const CAST_SECTIONS_FOR_PARTICIPATION = [CAST_SECTIONS.plot_characters, CAST_SECTIONS.obstacles];

interface ParticipationRow {
  entity_type: string;
  entity_id: number;
  manual: number;
  data: string;
}

/** Приключение и его главы — сцены лежат и там, и там. */
function arcIds(arcId: number): number[] {
  const chapters = db
    .prepare("SELECT id FROM story_arcs WHERE parent_id = ? AND campaign_id IS NULL")
    .all(arcId) as { id: number }[];
  return [arcId, ...chapters.map((c) => c.id)];
}

/** Силы из составов сцен приключения: сущность → сцены, где она есть. */
function castOfAdventure(arcId: number): Map<string, { type: string; id: number; scenes: { id: number; name: string }[] }> {
  const ids = arcIds(arcId);
  const rows = db
    .prepare(
      `SELECT l.to_type, l.to_id, s.id AS scene_id, s.name AS scene_name
       FROM generic_links l
       JOIN story_scenes s ON s.id = l.from_id
       WHERE l.from_type = 'scene'
         AND l.section IN (${CAST_SECTIONS_FOR_PARTICIPATION.map(() => "?").join(",")})
         AND s.arc_id IN (${ids.map(() => "?").join(",")})
         AND s.campaign_id IS NULL AND s.archived_at IS NULL
       ORDER BY s.position, s.id`
    )
    .all(...CAST_SECTIONS_FOR_PARTICIPATION, ...ids) as {
    to_type: string;
    to_id: number;
    scene_id: number;
    scene_name: string;
  }[];
  const out = new Map<string, { type: string; id: number; scenes: { id: number; name: string }[] }>();
  for (const r of rows) {
    if (!ADVENTURE_ENTITY_TYPES.has(r.to_type)) continue;
    const key = refKey(r.to_type, r.to_id);
    let item = out.get(key);
    if (!item) out.set(key, (item = { type: r.to_type, id: r.to_id, scenes: [] }));
    if (!item.scenes.some((sc) => sc.id === r.scene_id)) item.scenes.push({ id: r.scene_id, name: r.scene_name });
  }
  return out;
}

function arcExists(arcId: number): boolean {
  return !!db.prepare("SELECT 1 FROM story_arcs WHERE id = ?").get(arcId);
}

function positiveId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Участники приключения: из сцен + добавленные руками, с ходом событий.
participationsRouter.get("/adventure/:arcId", (req, res) => {
  const arcId = positiveId(req.params.arcId);
  if (!arcId || !arcExists(arcId)) return res.status(404).json({ error: "Приключение не найдено" });
  const cast = castOfAdventure(arcId);
  const stored = db
    .prepare("SELECT entity_type, entity_id, manual, data FROM participations WHERE context_type = 'adventure' AND context_id = ?")
    .all(arcId) as ParticipationRow[];
  const storedByKey = new Map(stored.map((r) => [refKey(r.entity_type, r.entity_id), r]));
  const keys = new Set<string>([...cast.keys()]);
  for (const r of stored) if (r.manual) keys.add(refKey(r.entity_type, r.entity_id));
  const refs = [...keys].map((k) => {
    const [type, id] = k.split(":");
    return { kind: type, id: Number(id) };
  });
  const names = entityNames(refs);
  const participants = refs
    .map(({ kind, id }) => {
      const key = refKey(kind, id);
      const row = storedByKey.get(key);
      return {
        entity_type: kind,
        entity_id: id,
        name: names.get(key) ?? `#${id}`,
        manual: !!row?.manual,
        scenes: cast.get(key)?.scenes ?? [],
        data: parseParticipation(row?.data),
      };
    })
    // Записи, которых больше нет, не показываем: связь висит, а сущности нет.
    .filter((p) => names.has(refKey(p.entity_type, p.entity_id)))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  res.json({ participants });
});

// Записать ход событий участника приключения или добавить закулисную силу
// (manual: true). Ключи вне словаря отбрасываются.
participationsRouter.put("/adventure/:arcId/:entityType/:entityId", (req, res) => {
  const arcId = positiveId(req.params.arcId);
  const entityId = positiveId(req.params.entityId);
  const entityType = req.params.entityType;
  if (!arcId || !arcExists(arcId)) return res.status(404).json({ error: "Приключение не найдено" });
  if (!entityId || !ADVENTURE_ENTITY_TYPES.has(entityType))
    return res.status(400).json({ error: "Участником приключения может быть существо или сообщество" });
  if (!entityNames([{ kind: entityType, id: entityId }]).size) return res.status(404).json({ error: "Сущность не найдена" });
  const body = (req.body ?? {}) as { data?: unknown; manual?: unknown };
  const existing = db
    .prepare("SELECT manual, data FROM participations WHERE context_type = 'adventure' AND context_id = ? AND entity_type = ? AND entity_id = ?")
    .get(arcId, entityType, entityId) as { manual: number; data: string } | undefined;
  const manual = typeof body.manual === "boolean" ? (body.manual ? 1 : 0) : (existing?.manual ?? 0);
  const data = body.data !== undefined ? serializeParticipation(body.data) : (existing?.data ?? "{}");
  db.prepare(
    `INSERT INTO participations (context_type, context_id, entity_type, entity_id, manual, data)
     VALUES ('adventure', ?, ?, ?, ?, ?)
     ON CONFLICT (context_type, context_id, entity_type, entity_id)
     DO UPDATE SET manual = excluded.manual, data = excluded.data, updated_at = datetime('now')`
  ).run(arcId, entityType, entityId, manual, data);
  res.json({ ok: true, manual: !!manual, data: parseParticipation(data) });
});

// Убрать участие: закулисная сила уходит из списка, у участника из сцен
// стирается записанный ход событий (сам он остаётся — его держит сцена).
participationsRouter.delete("/adventure/:arcId/:entityType/:entityId", (req, res) => {
  const arcId = positiveId(req.params.arcId);
  const entityId = positiveId(req.params.entityId);
  if (!arcId || !entityId) return res.status(400).json({ error: "Неверный адрес" });
  db.prepare(
    "DELETE FROM participations WHERE context_type = 'adventure' AND context_id = ? AND entity_type = ? AND entity_id = ?"
  ).run(arcId, req.params.entityType, entityId);
  res.json({ ok: true });
});

// «Участвует» во «Связях» существа или сообщества (гриллинг профилей
// 2026-10-02, Q16; тикет 11): приключения, где оно сила, — с целью из хода
// событий, под ними его сцены с ролью. Те же источники, что у участников
// приключения: составы сцен (без лута и локаций) и закулисные записи.
participationsRouter.get("/entity/:entityType/:entityId", (req, res) => {
  const entityType = req.params.entityType;
  const entityId = positiveId(req.params.entityId);
  if (!entityId || !ADVENTURE_ENTITY_TYPES.has(entityType))
    return res.status(400).json({ error: "Участвовать может существо или сообщество" });
  const sceneRows = db
    .prepare(
      `SELECT s.id AS scene_id, s.name AS scene_name, l.section, lp.data AS participation,
              COALESCE(ch.parent_id, a.id) AS adventure_id
       FROM generic_links l
       JOIN story_scenes s ON s.id = l.from_id
       JOIN story_arcs a ON a.id = s.arc_id
       LEFT JOIN story_arcs ch ON ch.id = a.id AND a.kind = 'chapter'
       LEFT JOIN link_participation lp ON lp.link_id = l.id
       WHERE l.from_type = 'scene' AND l.to_type = ? AND l.to_id = ?
         AND l.section IN (${CAST_SECTIONS_FOR_PARTICIPATION.map(() => "?").join(",")})
         AND s.campaign_id IS NULL AND s.archived_at IS NULL
         AND a.campaign_id IS NULL AND a.archived_at IS NULL
       ORDER BY s.position, s.id`
    )
    .all(entityType, entityId, ...CAST_SECTIONS_FOR_PARTICIPATION) as {
    scene_id: number;
    scene_name: string;
    section: string;
    participation: string | null;
    adventure_id: number;
  }[];
  const stored = db
    .prepare(
      `SELECT context_id, manual, data FROM participations
       WHERE context_type = 'adventure' AND entity_type = ? AND entity_id = ?`
    )
    .all(entityType, entityId) as { context_id: number; manual: number; data: string }[];
  const storedById = new Map(stored.map((r) => [r.context_id, r]));
  const ids = new Set<number>(sceneRows.map((r) => r.adventure_id));
  for (const r of stored) if (r.manual) ids.add(r.context_id);
  if (ids.size === 0) return res.json({ adventures: [] });
  const arcs = db
    .prepare(
      `SELECT id, name FROM story_arcs WHERE id IN (${[...ids].map(() => "?").join(",")})
         AND campaign_id IS NULL AND archived_at IS NULL`
    )
    .all(...ids) as { id: number; name: string }[];
  const adventures = arcs
    .map((a) => {
      const row = storedById.get(a.id);
      const scenes: { id: number; name: string; section: string; role: string; tactic: string }[] = [];
      for (const r of sceneRows) {
        if (r.adventure_id !== a.id || scenes.some((sc) => sc.id === r.scene_id)) continue;
        const p = parseSceneParticipation(r.participation);
        scenes.push({ id: r.scene_id, name: r.scene_name, section: r.section, role: p.role ?? "", tactic: p.tactic ?? "" });
      }
      return { id: a.id, name: a.name, manual: !!row?.manual, goal: parseParticipation(row?.data).goal ?? "", scenes };
    })
    .sort((x, y) => x.name.localeCompare(y.name, "ru"));
  res.json({ adventures });
});

// Персонаж игрока в кампании: почему здесь, личная ставка, почему сейчас.
participationsRouter.get("/campaign/:campaignId/character/:characterId", (req, res) => {
  const campaignId = positiveId(req.params.campaignId);
  const characterId = positiveId(req.params.characterId);
  if (!campaignId || !characterId) return res.status(400).json({ error: "Неверный адрес" });
  const row = db
    .prepare(
      "SELECT data FROM participations WHERE context_type = 'campaign' AND context_id = ? AND entity_type = 'character' AND entity_id = ?"
    )
    .get(campaignId, characterId) as { data: string } | undefined;
  res.json({ data: parsePcParticipation(row?.data) });
});

participationsRouter.put("/campaign/:campaignId/character/:characterId", (req, res) => {
  const campaignId = positiveId(req.params.campaignId);
  const characterId = positiveId(req.params.characterId);
  if (!campaignId || !characterId) return res.status(400).json({ error: "Неверный адрес" });
  const character = db.prepare("SELECT campaign_id FROM characters WHERE id = ?").get(characterId) as
    | { campaign_id: number | null }
    | undefined;
  if (!character) return res.status(404).json({ error: "Персонаж не найден" });
  if (character.campaign_id !== campaignId) return res.status(400).json({ error: "Персонаж не в этой кампании" });
  const data = serializePcParticipation((req.body ?? {}).data);
  db.prepare(
    `INSERT INTO participations (context_type, context_id, entity_type, entity_id, data)
     VALUES ('campaign', ?, 'character', ?, ?)
     ON CONFLICT (context_type, context_id, entity_type, entity_id)
     DO UPDATE SET data = excluded.data, updated_at = datetime('now')`
  ).run(campaignId, characterId, data);
  res.json({ ok: true, data: parsePcParticipation(data) });
});
