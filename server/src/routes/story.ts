import { Router } from "express";
import { db } from "../db/db";
import {
  contentSceneId,
  copySceneChildren,
  detachFromLibrary,
  withLibraryContent,
} from "../story/library";
import { foreignLinksFor, repointSceneLink } from "../story/foreignLinks";
import { SCENE_SOUND_SECTION, sceneSoundSet } from "../story/stage";
import {
  CAST_ROLE_BY_SECTION,
  CAST_SECTIONS,
  CONSEQUENCE_SECTION,
  linkTargetName,
  setLinkQty,
} from "../story/cast";

export const storyRouter = Router();

// "Приключения" — arcs and scenes owned by a setting, plus the copy-on-write
// campaign layer described in schema.sql. Every scene-reading endpoint takes
// an optional ?campaign_id=: without it you see the setting's originals, with
// it you see the same list with that campaign's overrides swapped in.

const SCENE_FIELDS = [
  "name",
  "kind",
  "summary",
  "read_aloud",
  "whats_happening",
  "entry_condition",
  "outcomes",
  "hidden_from_players",
  "position",
  "arc_id",
] as const;

interface SceneRow {
  id: number;
  setting_id: number | null;
  arc_id: number | null;
  campaign_id: number | null;
  source_scene_id: number | null;
  /** Заполнено у вставки заготовки: строка читает её содержимое. */
  library_scene_id: number | null;
  /** Сцена лежит на полке заготовок. */
  in_library: number;
  name: string;
  position: number;
}

// Overrides a campaign has made, keyed by the original scene they replace.
function overrideMap(campaignId: number, settingId: number): Map<number, SceneRow> {
  const rows = db
    .prepare(
      `SELECT * FROM story_scenes
       WHERE campaign_id = ? AND setting_id = ? AND source_scene_id IS NOT NULL
         AND archived_at IS NULL`
    )
    .all(campaignId, settingId) as SceneRow[];
  return new Map(rows.map((r) => [r.source_scene_id as number, r]));
}

// The scene row an edit made inside `campaignId` should actually write to:
// the campaign's existing override, a freshly cloned one, or the row itself
// when it already belongs to that campaign (or when there's no campaign at
// all and we're editing the setting's original).
//
// Здесь же вставка отвязывается от заготовки. Это единственная точка входа
// всех правок сцены — текстов, проверок, наград, переходов, — и правило
// «тронул значит отвязал» держится ровно потому, что живёт в одном месте, а
// не повторяется в каждом эндпоинте.
function resolveWritableScene(sceneId: number, campaignId: number | null): SceneRow | null {
  const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(sceneId) as
    | SceneRow
    | undefined;
  if (!scene) return null;
  if (campaignId == null || scene.campaign_id === campaignId) {
    if (scene.library_scene_id != null) {
      detachFromLibrary(scene.id);
      return db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(scene.id) as SceneRow;
    }
    return scene;
  }

  const existing = db
    .prepare(
      "SELECT * FROM story_scenes WHERE campaign_id = ? AND source_scene_id = ? AND archived_at IS NULL"
    )
    .get(campaignId, sceneId) as SceneRow | undefined;
  if (existing) return existing;

  return cloneSceneForCampaign(sceneId, campaignId);
}

// First edit of a setting scene inside a campaign: deep-copy the row and
// everything hanging off it, so the campaign's version is fully independent
// and the original stays untouched.
//
// Место в дереве берётся у самой сцены, а содержимое — оттуда, где оно
// лежит: у нетронутой вставки заготовки своих текстов нет, и копия «как
// есть» приехала бы в кампанию пустой. Ссылку на заготовку копия не
// наследует: правка в кампании — это и есть то самое «тронул», после
// которого сцена живёт своей жизнью.
function cloneSceneForCampaign(sceneId: number, campaignId: number): SceneRow {
  const clone = db.transaction(() => {
    const source = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(sceneId) as Record<
      string,
      unknown
    >;
    const contentId = (source.library_scene_id as number | null) ?? sceneId;
    const content =
      contentId === sceneId
        ? source
        : ((db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(contentId) ??
            source) as Record<string, unknown>);

    const info = db
      .prepare(
        `INSERT INTO story_scenes
           (setting_id, arc_id, campaign_id, source_scene_id, name, kind, summary, read_aloud,
            whats_happening, entry_condition, outcomes, hidden_from_players, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        source.setting_id,
        source.arc_id,
        campaignId,
        sceneId,
        content.name,
        content.kind,
        content.summary,
        content.read_aloud,
        content.whats_happening,
        content.entry_condition,
        content.outcomes,
        content.hidden_from_players,
        source.position
      );
    const newId = Number(info.lastInsertRowid);
    copySceneChildren(contentId, newId);
    return db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(newId) as SceneRow;
  });
  return clone();
}

// Исходы одной проверки вместе с именем сцены, в которую ведёт связь: без
// имени панель показала бы «ведёт в #37».
function outcomesFor(checkId: number) {
  return db
    .prepare(
      `SELECT o.*, s.name AS target_name
       FROM story_check_outcomes o
       LEFT JOIN story_scenes s ON o.target_type = 'scene' AND s.id = o.target_id
       WHERE o.check_id = ? ORDER BY o.position, o.id`
    )
    .all(checkId);
}

function sceneExtras(sceneId: number) {
  const checks = db
    .prepare("SELECT * FROM story_scene_checks WHERE scene_id = ? ORDER BY position, id")
    .all(sceneId) as { id: number }[];
  return {
    checks: checks.map((c) => ({ ...c, outcomes: outcomesFor(c.id) })),
    rewards: db
      .prepare(
        `SELECT r.*, a.name as artifact_name FROM story_scene_rewards r
         LEFT JOIN artifacts a ON a.id = r.artifact_id
         WHERE r.scene_id = ? ORDER BY r.position, r.id`
      )
      .all(sceneId),
    transitions: db
      .prepare(
        `SELECT t.*, s.name as to_scene_name FROM story_scene_transitions t
         JOIN story_scenes s ON s.id = t.to_scene_id
         WHERE t.from_scene_id = ? ORDER BY t.position, t.id`
      )
      .all(sceneId),
  };
}

// ---------------------------------------------------------------- arcs

// Поля приключения, которые кампания может переписать под себя. Всё
// остальное (место в дереве, порядок, признак стандартного) принадлежит
// сеттингу и одинаково во всех кампаниях.
const ARC_OVERRIDE_FIELDS = [
  "name",
  "description",
  "hook",
  "recommended_level",
  "player_count",
  "duration",
  "source",
  "tags",
] as const;

interface ArcRow {
  id: number;
  setting_id: number;
  parent_id: number | null;
  campaign_id: number | null;
  source_arc_id: number | null;
  name: string;
  is_default: number;
  position: number;
}

// Правки приключений, сделанные внутри кампании, ключ — оригинал из
// сеттинга. Копия несёт только собственные тексты: главы, сцены, вехи и
// тайны всегда висят на оригинальной строке, поэтому наружу отдаётся id
// оригинала с подменёнными текстами, а не id копии. Иначе пришлось бы
// переклеивать половину базы при первой же правке названия.
function arcOverrideMap(campaignId: number, settingId: number): Map<number, Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT * FROM story_arcs
       WHERE campaign_id = ? AND setting_id = ? AND source_arc_id IS NOT NULL
         AND archived_at IS NULL`
    )
    .all(campaignId, settingId) as Record<string, unknown>[];
  return new Map(rows.map((r) => [r.source_arc_id as number, r]));
}

function applyArcOverride(
  arc: Record<string, unknown>,
  override: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!override) return { ...arc, is_override: false, override_id: null };
  const patch: Record<string, unknown> = {};
  for (const f of ARC_OVERRIDE_FIELDS) patch[f] = override[f];
  return { ...arc, ...patch, is_override: true, override_id: override.id as number };
}

// Строка приключения, в которую должна уйти правка, сделанная внутри
// кампании: уже существующая копия, свежая копия или сам оригинал, когда
// правят из сеттинга. Дети не копируются — глава получает свою копию только
// тогда, когда правят саму главу.
function resolveWritableArc(arcId: number, campaignId: number | null): ArcRow | null {
  const arc = db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(arcId) as ArcRow | undefined;
  if (!arc) return null;
  if (campaignId == null || arc.campaign_id === campaignId) return arc;

  const existing = db
    .prepare(
      "SELECT * FROM story_arcs WHERE campaign_id = ? AND source_arc_id = ? AND archived_at IS NULL"
    )
    .get(campaignId, arcId) as ArcRow | undefined;
  if (existing) return existing;

  const info = db
    .prepare(
      `INSERT INTO story_arcs
         (setting_id, parent_id, campaign_id, source_arc_id, name, kind, description, hook,
          recommended_level, player_count, duration, source, tags, thumbnail_image_path,
          is_default, position)
       SELECT setting_id, parent_id, ?, id, name, kind, description, hook,
              recommended_level, player_count, duration, source, tags, thumbnail_image_path,
              0, position
       FROM story_arcs WHERE id = ?`
    )
    .run(campaignId, arcId);
  return db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(Number(info.lastInsertRowid)) as ArcRow;
}

const ARC_FIELDS = [
  "name",
  "kind",
  "description",
  "hook",
  "recommended_level",
  "player_count",
  "duration",
  "source",
  "tags",
  "position",
  "parent_id",
] as const;

// Every setting owns exactly one "Сцены вне приключений" adventure so a scene
// always has a home; created on demand, and any scene left without an arc by
// an older version gets swept into it.
function ensureDefaultArc(settingId: number): number {
  const existing = db
    .prepare("SELECT id FROM story_arcs WHERE setting_id = ? AND is_default = 1")
    .get(settingId) as { id: number } | undefined;
  const id =
    existing?.id ??
    Number(
      db
        .prepare(
          `INSERT INTO story_arcs (setting_id, name, kind, is_default, position)
           VALUES (?, 'Сцены вне приключений', 'adventure', 1, -1)`
        )
        .run(settingId).lastInsertRowid
    );
  // Подметание бесхозных сцен — запись, а её нельзя делать на каждое чтение:
  // раздел кампании читает список приключений при каждом обновлении, и лишний
  // UPDATE каждый раз берёт блокировку записи в WAL (на медленном диске это
  // ощущается как подвисание интерфейса). Сначала дешёвая проверка, есть ли
  // вообще что подметать.
  const orphan = db
    .prepare("SELECT 1 FROM story_scenes WHERE setting_id = ? AND arc_id IS NULL LIMIT 1")
    .get(settingId);
  if (orphan) {
    db.prepare("UPDATE story_scenes SET arc_id = ? WHERE setting_id = ? AND arc_id IS NULL").run(
      id,
      settingId
    );
  }
  return id;
}

// Сцены книжного приключения висят не на нём самом, а на его главах: в списке
// приключений такое читалось как «0 сцен» у всего, что приехало импортом.
// Поэтому счёт идёт по дуге и её главам сразу. Для самой главы формула
// вырождается в её собственные сцены — детей у главы не бывает.
function sceneCountSql(alias: string) {
  return `(SELECT COUNT(*) FROM story_scenes s
             JOIN story_arcs sc ON sc.id = s.arc_id
            WHERE (sc.id = ${alias}.id OR sc.parent_id = ${alias}.id)
              AND sc.archived_at IS NULL AND sc.campaign_id IS NULL
              AND s.campaign_id IS NULL AND s.archived_at IS NULL)`;
}

/** Глав у приключения: у книжного их пять-шесть, у самодельного обычно ноль. */
function chapterCountSql(alias: string) {
  return `(SELECT COUNT(*) FROM story_arcs c
            WHERE c.parent_id = ${alias}.id AND c.archived_at IS NULL
              AND c.campaign_id IS NULL)`;
}

storyRouter.get("/arcs", (req, res) => {
  const { setting_id } = req.query as { setting_id?: string };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  ensureDefaultArc(Number(setting_id));
  const arcs = db
    .prepare(
      `SELECT a.*, ${sceneCountSql("a")} as scene_count,
              ${chapterCountSql("a")} as chapter_count
       FROM story_arcs a
       WHERE a.setting_id = ? AND a.archived_at IS NULL AND a.campaign_id IS NULL
       ORDER BY a.position, a.id`
    )
    .all(setting_id);
  res.json(arcs);
});

// Full adventure profile: its chapters, the scenes under each, milestones,
// secrets, rewards (own + rolled up from scenes) and the cast rolled up from
// every scene's links. ?campaign_id= swaps in that campaign's scene overrides
// and adds its milestone/secret/scene progress.
storyRouter.get("/arcs/:id", (req, res) => {
  const arc = db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(req.params.id) as
    | { id: number; setting_id: number }
    | undefined;
  if (!arc) return res.status(404).json({ error: "not found" });
  const campaignId = req.query.campaign_id ? Number(req.query.campaign_id) : null;

  const chapters = db
    .prepare(
      `SELECT a.*, ${sceneCountSql("a")} as scene_count FROM story_arcs a
       WHERE a.parent_id = ? AND a.archived_at IS NULL AND a.campaign_id IS NULL
       ORDER BY a.position, a.id`
    )
    .all(arc.id) as { id: number }[];
  const arcIds = [arc.id, ...chapters.map((c) => c.id)];
  const placeholders = arcIds.map(() => "?").join(",");

  const originals = db
    .prepare(
      `SELECT * FROM story_scenes
       WHERE arc_id IN (${placeholders}) AND campaign_id IS NULL AND archived_at IS NULL
       ORDER BY position, id`
    )
    .all(...arcIds) as SceneRow[];

  let scenes: Record<string, unknown>[] = originals.map((s) => ({
    ...s,
    is_override: false,
    campaign_only: false,
    state: null,
  }));
  if (campaignId != null) {
    const overrides = overrideMap(campaignId, arc.setting_id);
    const own = db
      .prepare(
        `SELECT * FROM story_scenes
         WHERE campaign_id = ? AND arc_id IN (${placeholders})
           AND source_scene_id IS NULL AND archived_at IS NULL
         ORDER BY position, id`
      )
      .all(campaignId, ...arcIds) as SceneRow[];
    const getState = db.prepare(
      "SELECT status, note FROM campaign_scene_state WHERE campaign_id = ? AND scene_id = ?"
    );
    scenes = [...originals.map((s) => overrides.get(s.id) ?? s), ...own]
      .map((s) => ({
        ...s,
        is_override: s.campaign_id === campaignId && s.source_scene_id != null,
        campaign_only: s.campaign_id === campaignId && s.source_scene_id == null,
        state: getState.get(campaignId, s.id) ?? null,
      }))
      .sort((a, b) => a.position - b.position || a.id - b.id);
  }

  // Собственные вехи и тайны кампании, доложенные в это приключение, идут
  // в общем списке с его родными: для мастера это один список целей.
  const milestones = db
    .prepare(
      `SELECT m.*, s.name as scene_name FROM story_milestones m
       LEFT JOIN story_scenes s ON s.id = m.scene_id
       WHERE m.arc_id = @arc AND (m.campaign_id IS NULL OR m.campaign_id = @campaign)
       ORDER BY m.position, m.id`
    )
    .all({ arc: arc.id, campaign: campaignId }) as { id: number }[];
  const secrets = db
    .prepare(
      `SELECT * FROM story_secrets
       WHERE arc_id = @arc AND (campaign_id IS NULL OR campaign_id = @campaign)
       ORDER BY position, id`
    )
    .all({ arc: arc.id, campaign: campaignId }) as { id: number }[];
  if (campaignId != null) {
    const ms = db.prepare(
      "SELECT achieved, note FROM campaign_milestone_state WHERE campaign_id = ? AND milestone_id = ?"
    );
    const ss = db.prepare(
      "SELECT revealed, note FROM campaign_secret_state WHERE campaign_id = ? AND secret_id = ?"
    );
    milestones.forEach((m) => Object.assign(m, { state: ms.get(campaignId, m.id) ?? null }));
    secrets.forEach((s) => Object.assign(s, { state: ss.get(campaignId, s.id) ?? null }));
  }

  // Rewards: the adventure's own plus every scene's, tagged with where they
  // come from so the profile can show one list.
  const sceneIds = (scenes as { id: number }[]).map((s) => s.id);
  const rewards = [
    ...(db
      .prepare(
        `SELECT r.*, a.name as artifact_name, NULL as scene_name
         FROM story_scene_rewards r LEFT JOIN artifacts a ON a.id = r.artifact_id
         WHERE r.arc_id = ? ORDER BY r.position, r.id`
      )
      .all(arc.id) as unknown[]),
    ...(sceneIds.length
      ? (db
          .prepare(
            `SELECT r.*, a.name as artifact_name, sc.name as scene_name
             FROM story_scene_rewards r
             LEFT JOIN artifacts a ON a.id = r.artifact_id
             JOIN story_scenes sc ON sc.id = r.scene_id
             WHERE r.scene_id IN (${sceneIds.map(() => "?").join(",")})
             ORDER BY r.position, r.id`
          )
          .all(...sceneIds) as unknown[])
      : []),
  ];

  const overrides = campaignId != null ? arcOverrideMap(campaignId, arc.setting_id) : null;
  res.json({
    ...applyArcOverride(arc as unknown as Record<string, unknown>, overrides?.get(arc.id)),
    chapters: chapters.map((c) =>
      applyArcOverride(c as unknown as Record<string, unknown>, overrides?.get(c.id))
    ),
    scenes,
    milestones,
    secrets,
    rewards,
    cast: collectCast(arc.id, sceneIds),
  });
});

// "Действующие лица": every entity linked from any scene of this adventure,
// deduplicated, with the scenes it appears in — plus links attached to the
// adventure itself (from_type='adventure').
function collectCast(arcId: number, sceneIds: number[]) {
  const rows: { to_type: string; to_id: number; section: string | null; scene_name: string | null }[] =
    [];
  rows.push(
    ...(db
      .prepare(
        "SELECT to_type, to_id, section, NULL as scene_name FROM generic_links WHERE from_type = 'adventure' AND from_id = ?"
      )
      .all(arcId) as typeof rows)
  );
  if (sceneIds.length) {
    rows.push(
      ...(db
        .prepare(
          `SELECT l.to_type, l.to_id, l.section, s.name as scene_name
           FROM generic_links l JOIN story_scenes s ON s.id = l.from_id
           WHERE l.from_type = 'scene' AND l.from_id IN (${sceneIds.map(() => "?").join(",")})`
        )
        .all(...sceneIds) as typeof rows)
    );
  }
  const byKey = new Map<
    string,
    { type: string; id: number; name: string; sections: string[]; scenes: string[] }
  >();
  for (const r of rows) {
    const table = NODE_NAME_TABLES[r.to_type];
    if (!table) continue;
    const key = `${r.to_type}:${r.to_id}`;
    let entry = byKey.get(key);
    if (!entry) {
      const row = db
        .prepare(`SELECT ${table.nameCol} as name FROM ${table.table} WHERE id = ?`)
        .get(r.to_id) as { name: string } | undefined;
      entry = { type: r.to_type, id: r.to_id, name: row?.name ?? `#${r.to_id}`, sections: [], scenes: [] };
      byKey.set(key, entry);
    }
    if (r.section && !entry.sections.includes(r.section)) entry.sections.push(r.section);
    if (r.scene_name && !entry.scenes.includes(r.scene_name)) entry.scenes.push(r.scene_name);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Name lookup for cast rows. Deliberately a local copy of links.ts's
// NODE_TABLES rather than an import: this one only needs the types a scene
// can actually link to, and must not grow a dependency on the graph module.
const NODE_NAME_TABLES: Record<string, { table: string; nameCol: string }> = {
  location: { table: "setting_locations", nameCol: "name" },
  being: { table: "setting_beings", nameCol: "name" },
  community: { table: "setting_communities", nameCol: "name" },
  character: { table: "characters", nameCol: "character_name" },
  artifact: { table: "artifacts", nameCol: "name" },
  resource: { table: "resources", nameCol: "name" },
  compendium_entry: { table: "compendium_entries", nameCol: "name" },
};

storyRouter.post("/arcs", (req, res) => {
  const { setting_id, parent_id, name, description } = req.body as {
    setting_id: number;
    parent_id?: number | null;
    name: string;
    description?: string;
  };
  if (!setting_id || !name?.trim()) {
    return res.status(400).json({ error: "setting_id and name are required" });
  }
  const position =
    (db
      .prepare(
        "SELECT MAX(position) as m FROM story_arcs WHERE setting_id = ? AND IFNULL(parent_id, 0) = IFNULL(?, 0)"
      )
      .get(setting_id, parent_id ?? null) as { m: number | null }).m ?? -1;
  const info = db
    .prepare(
      "INSERT INTO story_arcs (setting_id, parent_id, name, description, position) VALUES (?, ?, ?, ?, ?)"
    )
    .run(setting_id, parent_id ?? null, name.trim(), description ?? "", position + 1);
  res.status(201).json(db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(info.lastInsertRowid));
});

// Registered before PUT /arcs/:id, or Express matches "reorder" as :id (the
// same trap resources.ts documents).
storyRouter.put("/arcs/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const setPos = db.prepare("UPDATE story_arcs SET position = ? WHERE id = ?");
  db.transaction((ids: number[]) => ids.forEach((id, i) => setPos.run(i, id)))(order ?? []);
  res.json({ ok: true });
});

storyRouter.put("/scenes/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const setPos = db.prepare("UPDATE story_scenes SET position = ? WHERE id = ?");
  db.transaction((ids: number[]) => ids.forEach((id, i) => setPos.run(i, id)))(order ?? []);
  res.json({ ok: true });
});

// Перекрёстные ссылки — в общем /api/cross-links, см. routes/crossLinks.ts.

storyRouter.put("/arcs/:id", (req, res) => {
  const arc = db.prepare("SELECT is_default FROM story_arcs WHERE id = ?").get(req.params.id) as
    | { is_default: number }
    | undefined;
  if (!arc) return res.status(404).json({ error: "not found" });
  // The auto-created bucket keeps its name so it stays recognizable.
  if (arc.is_default === 1 && req.body.name !== undefined) {
    return res.status(400).json({ error: "Стандартное приключение нельзя переименовать" });
  }
  // Правка изнутри кампании уходит в её собственную копию приключения, а не
  // в оригинал сеттинга, который читают все остальные кампании.
  const campaignId = req.body.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableArc(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });
  const allowed: readonly string[] = campaignId != null ? ARC_OVERRIDE_FIELDS : ARC_FIELDS;

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of allowed) {
    if (req.body[field] === undefined) continue;
    sets.push(`${field} = ?`);
    values.push(req.body[field]);
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE story_arcs SET ${sets.join(", ")} WHERE id = ?`).run(...values, target.id);
  }
  const saved = db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(target.id) as Record<string, unknown>;
  if (campaignId == null) return res.json(saved);
  const original = db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(req.params.id) as Record<string, unknown>;
  res.json(applyArcOverride(original, saved));
});

// Отказ от собственной версии приключения: копия кампании удаляется, и
// сквозь неё снова виден оригинал сеттинга. Главы и сцены со своими копиями
// живут отдельно и этой кнопкой не затрагиваются.
storyRouter.post("/arcs/:id/revert", (req, res) => {
  const campaignId = Number(req.body.campaign_id);
  if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
  db.prepare("DELETE FROM story_arcs WHERE campaign_id = ? AND source_arc_id = ?").run(
    campaignId,
    req.params.id
  );
  res.json({ ok: true });
});

storyRouter.delete("/arcs/:id", (req, res) => {
  const arc = db.prepare("SELECT is_default FROM story_arcs WHERE id = ?").get(req.params.id) as
    | { is_default: number }
    | undefined;
  if (arc?.is_default === 1) {
    return res.status(400).json({ error: "Стандартное приключение нельзя архивировать" });
  }
  db.prepare("UPDATE story_arcs SET archived_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------- приключения кампании (привязка)

// Кампания видит не все приключения своего сеттинга, а только привязанные —
// иначе сеттинг с тремя импортированными книгами превращает её разделы в
// свалку из чужих глав. «Сцены вне приключений» привязки не требуют: они
// есть у кампании всегда и отвязать их нельзя, иначе собственные сцены
// кампании пропадут с экрана, оставшись в базе.
const HAS_CAMPAIGN_EDITS_SQL = `
  SELECT (
    EXISTS (SELECT 1 FROM story_arcs o
             WHERE o.campaign_id = @campaign
               AND o.source_arc_id IN (SELECT id FROM story_arcs WHERE id = @arc OR parent_id = @arc))
    OR EXISTS (SELECT 1 FROM story_scenes s
                WHERE s.campaign_id = @campaign
                  AND s.arc_id IN (SELECT id FROM story_arcs WHERE id = @arc OR parent_id = @arc))
    OR EXISTS (SELECT 1 FROM campaign_scene_state st JOIN story_scenes s ON s.id = st.scene_id
                WHERE st.campaign_id = @campaign
                  AND s.arc_id IN (SELECT id FROM story_arcs WHERE id = @arc OR parent_id = @arc))
    OR EXISTS (SELECT 1 FROM story_milestones m
                WHERE m.campaign_id = @campaign AND m.arc_id = @arc)
    OR EXISTS (SELECT 1 FROM story_secrets x
                WHERE x.campaign_id = @campaign AND x.arc_id = @arc)
    OR EXISTS (SELECT 1 FROM campaign_milestone_state ms JOIN story_milestones m2 ON m2.id = ms.milestone_id
                WHERE ms.campaign_id = @campaign AND m2.arc_id = @arc)
    OR EXISTS (SELECT 1 FROM campaign_secret_state ss JOIN story_secrets s2 ON s2.id = ss.secret_id
                WHERE ss.campaign_id = @campaign AND s2.arc_id = @arc)
  ) as has_edits`;

function campaignSettingId(campaignId: number): number | null {
  const row = db.prepare("SELECT setting_id FROM campaigns WHERE id = ?").get(campaignId) as
    | { setting_id: number | null }
    | undefined;
  return row?.setting_id ?? null;
}

// Приключения кампании в порядке привязки, с подменёнными текстами и
// «Сценами вне приключений» последним блоком.
function campaignAdventures(
  campaignId: number
): (Record<string, unknown> & { has_campaign_edits: boolean })[] {
  const settingId = campaignSettingId(campaignId);
  if (settingId == null) return [];
  ensureDefaultArc(settingId);
  const rows = db
    .prepare(
      `SELECT a.*, ca.position as link_position, ${sceneCountSql("a")} as scene_count,
              ${chapterCountSql("a")} as chapter_count
       FROM campaign_adventures ca
       JOIN story_arcs a ON a.id = ca.arc_id
       WHERE ca.campaign_id = ? AND a.archived_at IS NULL AND a.campaign_id IS NULL
       ORDER BY ca.position, a.id`
    )
    .all(campaignId) as Record<string, unknown>[];
  const bucket = db
    .prepare(
      `SELECT a.*, 1000000 as link_position, ${sceneCountSql("a")} as scene_count,
              ${chapterCountSql("a")} as chapter_count
       FROM story_arcs a
       WHERE a.setting_id = ? AND a.is_default = 1 AND a.archived_at IS NULL`
    )
    .all(settingId) as Record<string, unknown>[];
  const overrides = arcOverrideMap(campaignId, settingId);
  const hasEdits = db.prepare(HAS_CAMPAIGN_EDITS_SQL);
  return [...rows, ...bucket].map((a) => ({
    ...applyArcOverride(a, overrides.get(a.id as number)),
    has_campaign_edits:
      !!(hasEdits.get({ campaign: campaignId, arc: a.id }) as { has_edits: number }).has_edits,
  }));
}

storyRouter.get("/campaign-adventures", (req, res) => {
  const campaignId = Number(req.query.campaign_id);
  if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
  res.json(campaignAdventures(campaignId));
});

// Что ещё можно добавить в кампанию: приключения её сеттинга, которых в ней
// пока нет.
storyRouter.get("/campaign-adventures/available", (req, res) => {
  const campaignId = Number(req.query.campaign_id);
  if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
  const settingId = campaignSettingId(campaignId);
  if (settingId == null) return res.json([]);
  res.json(
    db
      .prepare(
        `SELECT a.id, a.name, a.recommended_level, ${sceneCountSql("a")} as scene_count,
                ${chapterCountSql("a")} as chapter_count
         FROM story_arcs a
         WHERE a.setting_id = ? AND a.archived_at IS NULL AND a.campaign_id IS NULL
           AND a.parent_id IS NULL AND a.is_default = 0
           AND a.id NOT IN (SELECT arc_id FROM campaign_adventures WHERE campaign_id = ?)
         ORDER BY a.position, a.id`
      )
      .all(settingId, campaignId)
  );
});

storyRouter.post("/campaign-adventures", (req, res) => {
  const { campaign_id, arc_id } = req.body as { campaign_id?: number; arc_id?: number };
  if (!campaign_id || !arc_id) {
    return res.status(400).json({ error: "campaign_id and arc_id are required" });
  }
  const position =
    (db
      .prepare("SELECT IFNULL(MAX(position), -1) as m FROM campaign_adventures WHERE campaign_id = ?")
      .get(campaign_id) as { m: number }).m + 1;
  db.prepare(
    "INSERT OR IGNORE INTO campaign_adventures (campaign_id, arc_id, position) VALUES (?, ?, ?)"
  ).run(campaign_id, arc_id, position);
  res.status(201).json({ ok: true });
});

storyRouter.put("/campaign-adventures/reorder", (req, res) => {
  const { campaign_id, order } = req.body as { campaign_id?: number; order?: number[] };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  const setPos = db.prepare(
    "UPDATE campaign_adventures SET position = ? WHERE campaign_id = ? AND arc_id = ?"
  );
  db.transaction((ids: number[]) => ids.forEach((id, i) => setPos.run(i, campaign_id, id)))(order ?? []);
  res.json({ ok: true });
});

// Отвязка убирает только связь. Собственные копии приключения, глав и сцен,
// а также прогресс кампании остаются в базе и вернутся, если приключение
// привязать заново.
storyRouter.delete("/campaign-adventures", (req, res) => {
  const campaignId = Number(req.query.campaign_id);
  const arcId = Number(req.query.arc_id);
  if (!campaignId || !arcId) {
    return res.status(400).json({ error: "campaign_id and arc_id are required" });
  }
  db.prepare("DELETE FROM campaign_adventures WHERE campaign_id = ? AND arc_id = ?").run(
    campaignId,
    arcId
  );
  res.json({ ok: true });
});

// ------------------------------------------------- разделы профиля кампании

// Сцены привязанных приключений: оригиналы сеттинга с подменёнными копиями
// кампании, её собственные сцены и её же прогресс. Ключ — arc_id оригинала:
// копия сцены наследует его, поэтому группировка не разъезжается.
function campaignScenesByArc(arcIds: number[], settingId: number, campaignId: number) {
  const byArc = new Map<number, Record<string, unknown>[]>();
  if (arcIds.length === 0) return byArc;
  const placeholders = arcIds.map(() => "?").join(",");
  const originals = db
    .prepare(
      `SELECT * FROM story_scenes
       WHERE arc_id IN (${placeholders}) AND campaign_id IS NULL AND archived_at IS NULL
       ORDER BY position, id`
    )
    .all(...arcIds) as SceneRow[];
  const overrides = overrideMap(campaignId, settingId);
  const own = db
    .prepare(
      `SELECT * FROM story_scenes
       WHERE campaign_id = ? AND arc_id IN (${placeholders})
         AND source_scene_id IS NULL AND archived_at IS NULL
       ORDER BY position, id`
    )
    .all(campaignId, ...arcIds) as SceneRow[];
  const getState = db.prepare(
    "SELECT status, note FROM campaign_scene_state WHERE campaign_id = ? AND scene_id = ?"
  );
  const all = [...originals.map((s) => overrides.get(s.id) ?? s), ...own]
    .map((s) => ({
      ...s,
      is_override: s.campaign_id === campaignId && s.source_scene_id != null,
      campaign_only: s.campaign_id === campaignId && s.source_scene_id == null,
      state: getState.get(campaignId, s.id) ?? null,
    }))
    .sort((a, b) => a.position - b.position || a.id - b.id);
  for (const scene of all) {
    const key = scene.arc_id as number;
    if (!byArc.has(key)) byArc.set(key, []);
    byArc.get(key)!.push(scene as unknown as Record<string, unknown>);
  }
  return byArc;
}

// Раздел «Главы и сцены»: приключение → главы → сцены одним запросом, чтобы
// свёрнутое дерево раскрывалось без похода на сервер за каждым уровнем.
storyRouter.get("/campaign-tree", (req, res) => {
  const campaignId = Number(req.query.campaign_id);
  if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
  const settingId = campaignSettingId(campaignId);
  if (settingId == null) return res.json([]);
  const adventures = campaignAdventures(campaignId);
  const overrides = arcOverrideMap(campaignId, settingId);

  const chaptersOf = db.prepare(
    `SELECT * FROM story_arcs
     WHERE parent_id = ? AND archived_at IS NULL AND campaign_id IS NULL
     ORDER BY position, id`
  );
  const tree = adventures.map((adv) => {
    const advId = adv.id as number;
    const chapters = chaptersOf.all(advId) as Record<string, unknown>[];
    const arcIds = [advId, ...chapters.map((c) => c.id as number)];
    const scenes = campaignScenesByArc(arcIds, settingId, campaignId);
    return {
      ...adv,
      scenes: scenes.get(advId) ?? [],
      chapters: chapters.map((c) => ({
        ...applyArcOverride(c, overrides.get(c.id as number)),
        scenes: scenes.get(c.id as number) ?? [],
      })),
    };
  });
  res.json(tree);
});

// Разделы «Вехи» и «Тайны и зацепки»: те же приключения, но с их вехами и
// тайнами, плюс собственные записи кампании, не привязанные ни к одному
// приключению.
function campaignGrouped(campaignId: number, kind: "milestones" | "secrets") {
  const settingId = campaignSettingId(campaignId);
  if (settingId == null) return { groups: [], own: [] };
  const adventures = campaignAdventures(campaignId);

  const rowsFor =
    kind === "milestones"
      ? db.prepare(
          `SELECT m.*, s.name as scene_name FROM story_milestones m
           LEFT JOIN story_scenes s ON s.id = m.scene_id
           WHERE m.arc_id = @arc AND (m.campaign_id IS NULL OR m.campaign_id = @campaign)
           ORDER BY m.position, m.id`
        )
      : db.prepare(
          `SELECT * FROM story_secrets
           WHERE arc_id = @arc AND (campaign_id IS NULL OR campaign_id = @campaign)
           ORDER BY position, id`
        );
  const stateFor =
    kind === "milestones"
      ? db.prepare(
          "SELECT achieved, note FROM campaign_milestone_state WHERE campaign_id = ? AND milestone_id = ?"
        )
      : db.prepare(
          "SELECT revealed, note FROM campaign_secret_state WHERE campaign_id = ? AND secret_id = ?"
        );
  const withState = (rows: { id: number }[]) =>
    rows.map((r) => ({ ...r, state: stateFor.get(campaignId, r.id) ?? null }));

  const groups = adventures.map((adv) => ({
    arc: { id: adv.id as number, name: adv.name as string, is_default: adv.is_default as number },
    items: withState(rowsFor.all({ arc: adv.id as number, campaign: campaignId }) as { id: number }[]),
  }));

  const ownRows =
    kind === "milestones"
      ? (db
          .prepare(
            `SELECT m.*, s.name as scene_name FROM story_milestones m
             LEFT JOIN story_scenes s ON s.id = m.scene_id
             WHERE m.campaign_id = ? AND m.arc_id IS NULL ORDER BY m.position, m.id`
          )
          .all(campaignId) as { id: number }[])
      : (db
          .prepare(
            "SELECT * FROM story_secrets WHERE campaign_id = ? AND arc_id IS NULL ORDER BY position, id"
          )
          .all(campaignId) as { id: number }[]);
  return { groups, own: withState(ownRows) };
}

storyRouter.get("/campaign-milestones", (req, res) => {
  const campaignId = Number(req.query.campaign_id);
  if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
  res.json(campaignGrouped(campaignId, "milestones"));
});

storyRouter.get("/campaign-secrets", (req, res) => {
  const campaignId = Number(req.query.campaign_id);
  if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
  res.json(campaignGrouped(campaignId, "secrets"));
});

// ------------------------------------------------------ milestones / secrets

storyRouter.post("/arcs/:id/milestones", (req, res) => {
  const { title, description, scene_id } = req.body as {
    title?: string;
    description?: string;
    scene_id?: number | null;
  };
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  const position =
    (db.prepare("SELECT MAX(position) as m FROM story_milestones WHERE arc_id = ?").get(req.params.id) as {
      m: number | null;
    }).m ?? -1;
  db.prepare(
    "INSERT INTO story_milestones (arc_id, scene_id, title, description, position) VALUES (?, ?, ?, ?, ?)"
  ).run(req.params.id, scene_id ?? null, title.trim(), description ?? "", position + 1);
  res.status(201).json({ ok: true });
});

// Собственная веха кампании: свободная (arc_id пустой) или доложенная в
// приключение сеттинга, не трогая его оригинал.
storyRouter.post("/milestones", (req, res) => {
  const { campaign_id, arc_id, title, description, scene_id } = req.body as {
    campaign_id?: number;
    arc_id?: number | null;
    title?: string;
    description?: string;
    scene_id?: number | null;
  };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  const position =
    (db
      .prepare(
        "SELECT MAX(position) as m FROM story_milestones WHERE IFNULL(arc_id, 0) = IFNULL(?, 0)"
      )
      .get(arc_id ?? null) as { m: number | null }).m ?? -1;
  const info = db
    .prepare(
      `INSERT INTO story_milestones (arc_id, campaign_id, scene_id, title, description, position)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(arc_id ?? null, campaign_id, scene_id ?? null, title.trim(), description ?? "", position + 1);
  res.status(201).json(db.prepare("SELECT * FROM story_milestones WHERE id = ?").get(info.lastInsertRowid));
});

// То же для тайн и зацепок: собственная запись кампании живёт в одной модели
// с тайнами приключений — с видом (тайна/улика/нить) и общим «раскрыта».
storyRouter.post("/secrets", (req, res) => {
  const { campaign_id, arc_id, title, content, kind } = req.body as {
    campaign_id?: number;
    arc_id?: number | null;
    title?: string;
    content?: string;
    kind?: string;
  };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  const position =
    (db
      .prepare("SELECT MAX(position) as m FROM story_secrets WHERE IFNULL(arc_id, 0) = IFNULL(?, 0)")
      .get(arc_id ?? null) as { m: number | null }).m ?? -1;
  const info = db
    .prepare(
      "INSERT INTO story_secrets (arc_id, campaign_id, kind, title, content, position) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(arc_id ?? null, campaign_id, kind ?? "secret", title.trim(), content ?? "", position + 1);
  res.status(201).json(db.prepare("SELECT * FROM story_secrets WHERE id = ?").get(info.lastInsertRowid));
});

storyRouter.put("/milestones/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const setPos = db.prepare("UPDATE story_milestones SET position = ? WHERE id = ?");
  db.transaction((ids: number[]) => ids.forEach((id, i) => setPos.run(i, id)))(order ?? []);
  res.json({ ok: true });
});

storyRouter.put("/milestones/:milestoneId", (req, res) => {
  const { title, description, scene_id } = req.body as Record<string, unknown>;
  db.prepare(
    `UPDATE story_milestones SET
       title = COALESCE(?, title), description = COALESCE(?, description),
       scene_id = CASE WHEN ? THEN ? ELSE scene_id END
     WHERE id = ?`
  ).run(
    (title as string) ?? null,
    (description as string) ?? null,
    scene_id !== undefined ? 1 : 0,
    (scene_id as number) ?? null,
    req.params.milestoneId
  );
  res.json(db.prepare("SELECT * FROM story_milestones WHERE id = ?").get(req.params.milestoneId));
});

storyRouter.delete("/milestones/:milestoneId", (req, res) => {
  db.prepare("DELETE FROM story_milestones WHERE id = ?").run(req.params.milestoneId);
  res.json({ ok: true });
});

storyRouter.put("/milestones/:milestoneId/state", (req, res) => {
  const { campaign_id, achieved, note } = req.body as {
    campaign_id: number;
    achieved?: boolean;
    note?: string;
  };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  db.prepare(
    `INSERT INTO campaign_milestone_state (campaign_id, milestone_id, achieved, note, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(campaign_id, milestone_id) DO UPDATE SET
       achieved = excluded.achieved, note = excluded.note, updated_at = datetime('now')`
  ).run(campaign_id, req.params.milestoneId, achieved ? 1 : 0, note ?? "");
  res.json({ ok: true });
});

storyRouter.post("/arcs/:id/secrets", (req, res) => {
  const { title, content, kind } = req.body as { title?: string; content?: string; kind?: string };
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  const position =
    (db.prepare("SELECT MAX(position) as m FROM story_secrets WHERE arc_id = ?").get(req.params.id) as {
      m: number | null;
    }).m ?? -1;
  db.prepare(
    "INSERT INTO story_secrets (arc_id, kind, title, content, position) VALUES (?, ?, ?, ?, ?)"
  ).run(req.params.id, kind ?? "secret", title.trim(), content ?? "", position + 1);
  res.status(201).json({ ok: true });
});

storyRouter.put("/secrets/:secretId", (req, res) => {
  const { title, content, kind } = req.body as Record<string, string | undefined>;
  db.prepare(
    `UPDATE story_secrets SET title = COALESCE(?, title), content = COALESCE(?, content),
       kind = COALESCE(?, kind) WHERE id = ?`
  ).run(title ?? null, content ?? null, kind ?? null, req.params.secretId);
  res.json(db.prepare("SELECT * FROM story_secrets WHERE id = ?").get(req.params.secretId));
});

storyRouter.delete("/secrets/:secretId", (req, res) => {
  db.prepare("DELETE FROM story_secrets WHERE id = ?").run(req.params.secretId);
  res.json({ ok: true });
});

storyRouter.put("/secrets/:secretId/state", (req, res) => {
  const { campaign_id, revealed, note, session_id } = req.body as {
    campaign_id: number;
    revealed?: boolean;
    note?: string;
    session_id?: number | null;
  };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  // Сессия запоминается только при раскрытии и только если её прислали:
  // тайну отмечают и с пульта, и из профиля сессии, и из профиля кампании —
  // в последнем случае вечера у неё нет. Снятие отметки чистит и сессию,
  // иначе «раскрылось в этот вечер» показало бы то, что потом отменили.
  const sid = revealed && session_id ? Number(session_id) : null;
  db.prepare(
    `INSERT INTO campaign_secret_state (campaign_id, secret_id, revealed, note, revealed_session_id, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(campaign_id, secret_id) DO UPDATE SET
       revealed = excluded.revealed,
       note = excluded.note,
       -- Пришла сессия — записываем; не пришла, но тайна остаётся раскрытой —
       -- оставляем прежнюю: правка заметки не должна стирать, где это было.
       revealed_session_id = CASE
         WHEN excluded.revealed = 0 THEN NULL
         WHEN excluded.revealed_session_id IS NOT NULL THEN excluded.revealed_session_id
         ELSE campaign_secret_state.revealed_session_id
       END,
       updated_at = datetime('now')`
  ).run(campaign_id, req.params.secretId, revealed ? 1 : 0, note ?? "", sid);
  res.json({ ok: true });
});

// Reward granted for the adventure as a whole rather than found in a scene.
storyRouter.post("/arcs/:id/rewards", (req, res) => {
  const position =
    (db.prepare("SELECT MAX(position) as m FROM story_scene_rewards WHERE arc_id = ?").get(req.params.id) as {
      m: number | null;
    }).m ?? -1;
  db.prepare(
    "INSERT INTO story_scene_rewards (arc_id, what, where_found, notes, artifact_id, position) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    req.params.id,
    req.body.what ?? "",
    req.body.where_found ?? "",
    req.body.notes ?? "",
    req.body.artifact_id ?? null,
    position + 1
  );
  res.status(201).json({ ok: true });
});

// -------------------------------------------------------------- scenes

storyRouter.get("/scenes", (req, res) => {
  const { setting_id, arc_id, campaign_id } = req.query as {
    setting_id?: string;
    arc_id?: string;
    campaign_id?: string;
  };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  const campaignId = campaign_id ? Number(campaign_id) : null;

  const clauses = ["s.setting_id = @setting_id", "s.archived_at IS NULL", "s.campaign_id IS NULL"];
  const params: Record<string, string | number> = { setting_id: Number(setting_id) };
  if (arc_id) {
    clauses.push("s.arc_id = @arc_id");
    params.arc_id = Number(arc_id);
  }
  const originals = db
    .prepare(`SELECT s.* FROM story_scenes s WHERE ${clauses.join(" AND ")} ORDER BY s.position, s.id`)
    .all(params) as SceneRow[];

  if (campaignId == null) {
    return res.json(
      originals.map((s) => ({
        ...withLibraryContent(s),
        is_override: false,
        state: null,
      }))
    );
  }

  const overrides = overrideMap(campaignId, Number(setting_id));
  const own = db
    .prepare(
      `SELECT * FROM story_scenes
       WHERE campaign_id = ? AND setting_id = ? AND source_scene_id IS NULL AND archived_at IS NULL
       ${arc_id ? "AND arc_id = ?" : ""}
       ORDER BY position, id`
    )
    .all(...(arc_id ? [campaignId, Number(setting_id), Number(arc_id)] : [campaignId, Number(setting_id)])) as SceneRow[];

  const getState = db.prepare("SELECT status, note FROM campaign_scene_state WHERE campaign_id = ? AND scene_id = ?");
  const resolved = [...originals.map((s) => overrides.get(s.id) ?? s), ...own].map((s) => ({
    ...withLibraryContent(s),
    is_override: s.campaign_id === campaignId && s.source_scene_id != null,
    campaign_only: s.campaign_id === campaignId && s.source_scene_id == null,
    // Progress is always keyed by the scene the campaign actually shows, so
    // an override and its original never both carry a status.
    state: getState.get(campaignId, s.id) ?? null,
  }));
  resolved.sort((a, b) => a.position - b.position || a.id - b.id);
  res.json(resolved);
});

storyRouter.get("/scenes/:id", (req, res) => {
  const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(req.params.id) as
    | SceneRow
    | undefined;
  if (!scene) return res.status(404).json({ error: "not found" });
  const campaignId = req.query.campaign_id ? Number(req.query.campaign_id) : null;
  // Asking for a setting original from inside a campaign that already
  // overrode it should show the override, not the original.
  let shown = scene;
  // setting_id может быть пустым у заготовки, чей сеттинг удалили: своих
  // переопределений у такой строки нет и искать их не по чему.
  if (campaignId != null && scene.campaign_id == null && scene.setting_id != null) {
    shown = (overrideMap(campaignId, scene.setting_id).get(scene.id) ?? scene) as SceneRow;
  }
  res.json({
    ...withLibraryContent(shown),
    is_override: shown.campaign_id != null && shown.source_scene_id != null,
    campaign_only: shown.campaign_id != null && shown.source_scene_id == null,
    state:
      campaignId != null
        ? db
            .prepare("SELECT status, note FROM campaign_scene_state WHERE campaign_id = ? AND scene_id = ?")
            .get(campaignId, shown.id) ?? null
        : null,
    // Проверки, награды и переходы у нетронутой вставки тоже читаются с
    // заготовки: своих у неё нет до первой правки.
    ...sceneExtras(contentSceneId(shown.id)),
  });
});

storyRouter.post("/scenes", (req, res) => {
  const body = req.body as Record<string, unknown> & {
    setting_id: number;
    arc_id?: number | null;
    campaign_id?: number | null;
    name: string;
  };
  if (!body.setting_id || !String(body.name ?? "").trim()) {
    return res.status(400).json({ error: "setting_id and name are required" });
  }
  const position =
    (db
      .prepare("SELECT MAX(position) as m FROM story_scenes WHERE IFNULL(arc_id, 0) = IFNULL(?, 0)")
      .get(body.arc_id ?? null) as { m: number | null }).m ?? -1;
  const info = db
    .prepare(
      `INSERT INTO story_scenes (setting_id, arc_id, campaign_id, name, kind, summary, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      body.setting_id,
      body.arc_id ?? null,
      body.campaign_id ?? null,
      String(body.name).trim(),
      (body.kind as string) ?? "scene",
      (body.summary as string) ?? "",
      position + 1
    );
  res.status(201).json(db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(info.lastInsertRowid));
});

storyRouter.put("/scenes/:id", (req, res) => {
  const campaignId = req.body.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableScene(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of SCENE_FIELDS) {
    if (req.body[field] === undefined) continue;
    sets.push(`${field} = ?`);
    values.push(field === "hidden_from_players" ? (req.body[field] ? 1 : 0) : req.body[field]);
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE story_scenes SET ${sets.join(", ")} WHERE id = ?`).run(...values, target.id);
  }
  res.json(db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(target.id));
});

storyRouter.delete("/scenes/:id", (req, res) => {
  // Уходящая с полки заготовка сначала материализует свои вставки: каждая
  // ещё не тронутая получает содержимое внутрь и становится обычной сценой.
  // Иначе из чужих приключений молча пропадает по сцене — а Мастер всего
  // лишь прибирал полку.
  const insertions = db
    .prepare("SELECT id FROM story_scenes WHERE library_scene_id = ? AND archived_at IS NULL")
    .all(req.params.id) as { id: number }[];
  insertions.forEach((i) => detachFromLibrary(i.id));
  db.prepare("UPDATE story_scenes SET archived_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true, materialized: insertions.length });
});

// Drop a campaign's override so the setting's original shows through again.
storyRouter.post("/scenes/:id/revert", (req, res) => {
  const campaignId = Number(req.body.campaign_id);
  if (!campaignId) return res.status(400).json({ error: "campaign_id is required" });
  const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(req.params.id) as
    | SceneRow
    | undefined;
  if (!scene) return res.status(404).json({ error: "not found" });
  const overrideId =
    scene.source_scene_id != null && scene.campaign_id === campaignId
      ? scene.id
      : (
          db
            .prepare("SELECT id FROM story_scenes WHERE campaign_id = ? AND source_scene_id = ?")
            .get(campaignId, scene.id) as { id: number } | undefined
        )?.id;
  if (overrideId) {
    db.prepare("DELETE FROM generic_links WHERE from_type = 'scene' AND from_id = ?").run(overrideId);
    db.prepare("DELETE FROM story_scenes WHERE id = ?").run(overrideId);
  }
  res.json({ ok: true });
});

storyRouter.put("/scenes/:id/state", (req, res) => {
  const { campaign_id, status, note } = req.body as {
    campaign_id: number;
    status?: string;
    note?: string;
  };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  db.prepare(
    `INSERT INTO campaign_scene_state (campaign_id, scene_id, status, note, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(campaign_id, scene_id) DO UPDATE SET
       status = COALESCE(excluded.status, status),
       note = COALESCE(excluded.note, note),
       updated_at = datetime('now')`
  ).run(campaign_id, req.params.id, status ?? "pending", note ?? "");
  res.json(
    db
      .prepare("SELECT status, note FROM campaign_scene_state WHERE campaign_id = ? AND scene_id = ?")
      .get(campaign_id, req.params.id)
  );
});

// --------------------------------------------------- состав сцены (холст)

/**
 * Воткнуть сущность в сцену. Проходит через resolveWritableScene, поэтому
 * работает и copy-on-write кампании, и отвязка вставки от заготовки:
 * протянутая стрелка — такая же правка сцены, как правка текста.
 */
storyRouter.post("/scenes/:id/cast", (req, res) => {
  const { to_type, to_id, role, qty } = req.body as {
    to_type?: string;
    to_id?: number;
    role?: string;
    qty?: string;
  };
  // «Последствия» — не состав, но втыкается тем же эндпоинтом: для сервера
  // это такая же связь сцены, отличается только разъёмом и направлением
  // смысла.
  const section = role === "consequences" ? CONSEQUENCE_SECTION : CAST_SECTIONS[role ?? ""];
  if (!to_type || !to_id || !section) {
    return res.status(400).json({ error: "to_type, to_id and a known role are required" });
  }
  const campaignId = req.body.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableScene(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });

  // Сначала ищем, потом вставляем. Раньше было наоборот — `INSERT OR IGNORE`,
  // а при changes = 0 достать существующую строку, — и это разваливалось на
  // ровном месте: `OR IGNORE` молчит про любое нарушение ограничения, а не
  // только про UNIQUE, и когда поиск не находил строку, маршрут падал с
  // «Cannot read properties of undefined». Ошибка вместо связи прямо во время
  // разметки приключения — слишком дорого за экономию одного запроса.
  const existing = db
    .prepare(
      `SELECT id FROM generic_links
       WHERE from_type = 'scene' AND from_id = ? AND to_type = ? AND to_id = ? AND section = ?`
    )
    .get(target.id, to_type, Number(to_id), section) as { id: number } | undefined;

  const linkId =
    existing?.id ??
    Number(
      db
        .prepare(
          `INSERT INTO generic_links (from_type, from_id, to_type, to_id, section)
           VALUES ('scene', ?, ?, ?, ?)`
        )
        .run(target.id, to_type, Number(to_id), section).lastInsertRowid
    );

  if (qty != null && String(qty).trim()) setLinkQty(linkId, String(qty));
  res.status(201).json({ link_id: linkId, scene_id: target.id });
});

/**
 * Состав сцены: кто в ней участвует, где она происходит и что в ней лежит —
 * с именами и количествами.
 *
 * Отдельным запросом, а не полем sceneExtras: страница сцены собирает то же
 * самое своими drop-зонами через /links, и подмешивать состав в общий ответ
 * значило бы завести второй источник того же списка.
 */
storyRouter.get("/scenes/:id/cast", (req, res) => {
  // У нетронутой вставки состав тоже читается с заготовки: своего у неё нет.
  const sceneId = contentSceneId(Number(req.params.id));
  const rows = db
    .prepare(
      `SELECT l.id AS link_id, l.section, l.to_type, l.to_id, IFNULL(c.qty, '') AS qty
       FROM generic_links l LEFT JOIN link_cast c ON c.link_id = l.id
       WHERE l.from_type = 'scene' AND l.from_id = ?
         AND l.section IN (${Object.values(CAST_SECTIONS).map(() => "?").join(",")})
       ORDER BY l.section, l.id`
    )
    .all(sceneId, ...Object.values(CAST_SECTIONS)) as {
    link_id: number;
    section: string;
    to_type: string;
    to_id: number;
    qty: string;
  }[];
  res.json(
    rows.map((r) => ({
      ...r,
      role: CAST_ROLE_BY_SECTION[r.section],
      name: linkTargetName(r.to_type, r.to_id),
    }))
  );
});

/**
 * Количество на связи: «4», «1к6», «2к4+1».
 *
 * Пустая строка убирает спутника, а не хранит пустоту: «один» — умолчание, и
 * подписывать им каждую стрелку значит зашумить схему ради нуля информации.
 */
storyRouter.put("/cast/:linkId", (req, res) => {
  const qty = String((req.body as { qty?: string }).qty ?? "");
  setLinkQty(Number(req.params.linkId), qty);
  res.json({ ok: true });
});

storyRouter.delete("/cast/:linkId", (req, res) => {
  db.prepare("DELETE FROM generic_links WHERE id = ?").run(req.params.linkId);
  res.json({ ok: true });
});

// ------------------------------------------------------- полка заготовок

/**
 * Полка. Глобальная и над сеттингами: заготовка, написанная в одном мире,
 * предлагается и в другом — переносимость определяется содержимым, а не
 * галочкой, и решает это Мастер, а не фильтр.
 *
 * setting_id в запросе — не фильтр, а «откуда смотрят»: свои заготовки
 * поднимаются наверх, чужие помечаются именем сеттинга.
 */
storyRouter.get("/library", (req, res) => {
  const settingId = req.query.setting_id ? Number(req.query.setting_id) : null;
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.summary, s.setting_id, s.arc_id,
              t.name AS setting_name, a.name AS arc_name,
              (SELECT COUNT(*) FROM story_scenes i
                WHERE i.library_scene_id = s.id AND i.archived_at IS NULL) AS insertions
       FROM story_scenes s
       LEFT JOIN settings t ON t.id = s.setting_id
       LEFT JOIN story_arcs a ON a.id = s.arc_id AND a.is_default = 0
       WHERE s.in_library = 1 AND s.archived_at IS NULL AND s.campaign_id IS NULL
       ORDER BY s.name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[];
  const shelf = rows.map((r) => ({ ...r, foreign: settingId != null && r.setting_id !== settingId }));
  shelf.sort((a, b) => Number(a.foreign) - Number(b.foreign));
  res.json(shelf);
});

/**
 * Положить сцену на полку / снять с полки.
 *
 * Сцена кампании кладётся НЕЗАВИСИМОЙ КОПИЕЙ, а не собой: строка кампании
 * умирает вместе с кампанией, а полка переживает всё остальное. Ссылаться на
 * смертное значит строить цепочку, у которой середина исчезнет.
 */
storyRouter.post("/scenes/:id/library", (req, res) => {
  const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(req.params.id) as
    | SceneRow
    | undefined;
  if (!scene) return res.status(404).json({ error: "not found" });

  if (scene.campaign_id == null) {
    db.prepare("UPDATE story_scenes SET in_library = 1 WHERE id = ?").run(scene.id);
    return res.json(db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(scene.id));
  }

  const copy = db.transaction(() => {
    const contentId = scene.library_scene_id ?? scene.id;
    const content = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(contentId) as Record<
      string,
      unknown
    >;
    // Копия ложится на полку бездомной: приключение и кампания, где сцену
    // писали, к заготовке отношения не имеют.
    const info = db
      .prepare(
        `INSERT INTO story_scenes
           (setting_id, in_library, name, kind, summary, read_aloud, whats_happening,
            entry_condition, outcomes, hidden_from_players, position)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        scene.setting_id,
        content.name,
        content.kind,
        content.summary,
        content.read_aloud,
        content.whats_happening,
        content.entry_condition,
        content.outcomes,
        content.hidden_from_players
      );
    const newId = Number(info.lastInsertRowid);
    copySceneChildren(contentId, newId);
    return db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(newId);
  });
  res.status(201).json(copy());
});

storyRouter.delete("/scenes/:id/library", (req, res) => {
  // Только снимаем с полки. Уже сделанные вставки продолжают читать эту
  // сцену: снять с полки — значит «больше не предлагать», а не «отобрать у
  // тех, кто взял».
  db.prepare("UPDATE story_scenes SET in_library = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

/**
 * Вставить заготовку в приключение. Появляется строка-ссылка: своё место и
 * порядок, но тексты читаются с заготовки, пока вставку не тронули.
 */
storyRouter.post("/library/:id/insert", (req, res) => {
  const blank = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(req.params.id) as
    | SceneRow
    | undefined;
  if (!blank) return res.status(404).json({ error: "not found" });
  const { arc_id, campaign_id } = req.body as { arc_id?: number; campaign_id?: number | null };
  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });
  const arc = db.prepare("SELECT id, setting_id FROM story_arcs WHERE id = ?").get(arc_id) as
    | { id: number; setting_id: number }
    | undefined;
  if (!arc) return res.status(404).json({ error: "arc not found" });

  const position =
    ((db
      .prepare("SELECT MAX(position) as m FROM story_scenes WHERE arc_id = ?")
      .get(arc_id) as { m: number | null }).m ?? -1) + 1;
  // Сеттинг у вставки — тот, куда вставили, а не тот, где написана
  // заготовка: сцена стоит в этом приключении и принадлежит ему.
  const info = db
    .prepare(
      `INSERT INTO story_scenes (setting_id, arc_id, campaign_id, library_scene_id, name, position)
       VALUES (?, ?, ?, ?, '', ?)`
    )
    .run(arc.setting_id, arc_id, campaign_id ?? null, blank.id, position);
  const created = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(withLibraryContent(created as SceneRow));
});

/**
 * Чужие ссылки сцены: на кого она показывает за пределы своего сеттинга и
 * что в этом сеттинге можно предложить взамен.
 */
storyRouter.get("/scenes/:id/foreign-links", (req, res) => {
  res.json(foreignLinksFor(Number(req.params.id)));
});

/**
 * Перевести чужую ссылку на местную запись.
 *
 * Разбор — это правка сцены, поэтому вставка сначала отвязывается от
 * заготовки: чинить ссылки «на месте» значило бы переписать заготовку и
 * поменять её во всех остальных приключениях, где она стоит. Мастер правит
 * свою сцену, а не общую полку.
 */
storyRouter.post("/scenes/:id/foreign-links/repoint", (req, res) => {
  const { to_type, from_id, to_id } = req.body as {
    to_type?: string;
    from_id?: number;
    to_id?: number;
  };
  if (!to_type || !from_id || !to_id) {
    return res.status(400).json({ error: "to_type, from_id and to_id are required" });
  }
  const campaignId = req.body.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableScene(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });
  const moved = repointSceneLink(target.id, to_type, Number(from_id), Number(to_id));
  res.json({ ...moved, scene_id: target.id });
});

/**
 * Отвязать вставку руками. Отдельно от автоматики намеренно: «эта засада
 * дальше пойдёт своим путём» решают ДО правки, а не в момент.
 */
storyRouter.post("/scenes/:id/detach", (req, res) => {
  const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(req.params.id) as
    | SceneRow
    | undefined;
  if (!scene) return res.status(404).json({ error: "not found" });
  detachFromLibrary(scene.id);
  res.json(db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(scene.id));
});

// ------------------------------------------------- checks / rewards / edges

storyRouter.post("/scenes/:id/checks", (req, res) => {
  const campaignId = req.body.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableScene(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });
  const position =
    (db.prepare("SELECT MAX(position) as m FROM story_scene_checks WHERE scene_id = ?").get(target.id) as {
      m: number | null;
    }).m ?? -1;
  // on_success/on_failure не заполняются: последствия живут в исходах, а
  // колонки ждут ближайшей пересборки таблицы. Писать в них «на всякий
  // случай» значит завести второе место для того же текста и следующей же
  // правкой исхода их рассинхронить.
  db.prepare(
    "INSERT INTO story_scene_checks (scene_id, what, difficulty, position) VALUES (?, ?, ?, ?)"
  ).run(target.id, req.body.what ?? "", req.body.difficulty ?? "", position + 1);
  // Новая проверка сразу получает два исхода: нода без разъёмов ничего не
  // ветвит, а «добавьте исход» — работа, которую Мастер делал бы каждый раз.
  // Тексты берутся из on_success/on_failure тела запроса — так их называет
  // форма на странице сцены, и переучивать её ради имён колонок незачем.
  const checkId = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
  const addOutcome = db.prepare(
    "INSERT INTO story_check_outcomes (check_id, label, consequence, position) VALUES (?, ?, ?, ?)"
  );
  addOutcome.run(checkId.id, "Успех", req.body.on_success ?? "", 0);
  addOutcome.run(checkId.id, "Провал", req.body.on_failure ?? "", 1);
  res.status(201).json(sceneExtras(target.id).checks);
});

storyRouter.put("/checks/:checkId", (req, res) => {
  // Последствия сюда не принимаются: у них своя таблица и свои эндпоинты
  // (/checks/:id/outcomes, /outcomes/:id). Оставить приём on_success значило
  // бы держать путь записи в колонку, которую никто не читает.
  const { what, difficulty } = req.body as Record<string, string | undefined>;
  db.prepare(
    `UPDATE story_scene_checks SET
       what = COALESCE(?, what), difficulty = COALESCE(?, difficulty)
     WHERE id = ?`
  ).run(what ?? null, difficulty ?? null, req.params.checkId);
  res.json(db.prepare("SELECT * FROM story_scene_checks WHERE id = ?").get(req.params.checkId));
});

storyRouter.delete("/checks/:checkId", (req, res) => {
  db.prepare("DELETE FROM story_scene_checks WHERE id = ?").run(req.params.checkId);
  res.json({ ok: true });
});

// ------------------------------------------------- исходы проверки
//
// Свободный список: у D&D их два, у Legends in the Mist три, у Daggerheart
// четыре. Подпись — имя разъёма, `consequence` — что происходит словами,
// target_* — необязательная связь «а дальше вот сюда». См. schema.sql.

storyRouter.post("/checks/:checkId/outcomes", (req, res) => {
  const checkId = Number(req.params.checkId);
  const exists = db.prepare("SELECT id FROM story_scene_checks WHERE id = ?").get(checkId);
  if (!exists) return res.status(404).json({ error: "not found" });
  const position =
    (db.prepare("SELECT MAX(position) as m FROM story_check_outcomes WHERE check_id = ?").get(checkId) as {
      m: number | null;
    }).m ?? -1;
  db.prepare(
    `INSERT INTO story_check_outcomes (check_id, label, consequence, target_type, target_id, position)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    checkId,
    req.body.label ?? "",
    req.body.consequence ?? "",
    req.body.target_type ?? null,
    req.body.target_id ?? null,
    position + 1
  );
  res.status(201).json(outcomesFor(checkId));
});

storyRouter.put("/outcomes/:outcomeId", (req, res) => {
  const { label, consequence } = req.body as Record<string, string | undefined>;
  // target_* правится иначе, чем тексты: связь снимают, присваивая null, а
  // COALESCE такое отличить не может — «не передали» и «очистить» выглядят
  // одинаково. Поэтому явная проверка на присутствие ключа в теле.
  const hasTarget = Object.prototype.hasOwnProperty.call(req.body, "target_type");
  db.prepare(
    `UPDATE story_check_outcomes SET
       label = COALESCE(?, label),
       consequence = COALESCE(?, consequence),
       target_type = CASE WHEN ? THEN ? ELSE target_type END,
       target_id = CASE WHEN ? THEN ? ELSE target_id END
     WHERE id = ?`
  ).run(
    label ?? null,
    consequence ?? null,
    hasTarget ? 1 : 0,
    req.body.target_type ?? null,
    hasTarget ? 1 : 0,
    req.body.target_id ?? null,
    req.params.outcomeId
  );
  res.json(db.prepare("SELECT * FROM story_check_outcomes WHERE id = ?").get(req.params.outcomeId));
});

storyRouter.delete("/outcomes/:outcomeId", (req, res) => {
  db.prepare("DELETE FROM story_check_outcomes WHERE id = ?").run(req.params.outcomeId);
  res.json({ ok: true });
});

storyRouter.post("/scenes/:id/rewards", (req, res) => {
  const campaignId = req.body.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableScene(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });
  const position =
    (db.prepare("SELECT MAX(position) as m FROM story_scene_rewards WHERE scene_id = ?").get(target.id) as {
      m: number | null;
    }).m ?? -1;
  db.prepare(
    "INSERT INTO story_scene_rewards (scene_id, what, where_found, notes, artifact_id, position) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    target.id,
    req.body.what ?? "",
    req.body.where_found ?? "",
    req.body.notes ?? "",
    req.body.artifact_id ?? null,
    position + 1
  );
  res.status(201).json(sceneExtras(target.id).rewards);
});

storyRouter.put("/rewards/:rewardId", (req, res) => {
  const { what, where_found, notes, artifact_id } = req.body as Record<string, unknown>;
  db.prepare(
    `UPDATE story_scene_rewards SET
       what = COALESCE(?, what), where_found = COALESCE(?, where_found),
       notes = COALESCE(?, notes),
       artifact_id = CASE WHEN ? THEN ? ELSE artifact_id END
     WHERE id = ?`
  ).run(
    (what as string) ?? null,
    (where_found as string) ?? null,
    (notes as string) ?? null,
    artifact_id !== undefined ? 1 : 0,
    (artifact_id as number) ?? null,
    req.params.rewardId
  );
  res.json(db.prepare("SELECT * FROM story_scene_rewards WHERE id = ?").get(req.params.rewardId));
});

storyRouter.delete("/rewards/:rewardId", (req, res) => {
  db.prepare("DELETE FROM story_scene_rewards WHERE id = ?").run(req.params.rewardId);
  res.json({ ok: true });
});

storyRouter.post("/scenes/:id/transitions", (req, res) => {
  const campaignId = req.body.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableScene(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });
  const { to_scene_id, label } = req.body as { to_scene_id: number; label?: string };
  if (!to_scene_id) return res.status(400).json({ error: "to_scene_id is required" });
  db.prepare(
    "INSERT OR IGNORE INTO story_scene_transitions (from_scene_id, to_scene_id, label) VALUES (?, ?, ?)"
  ).run(target.id, to_scene_id, label ?? "");
  res.status(201).json(sceneExtras(target.id).transitions);
});

storyRouter.delete("/transitions/:transitionId", (req, res) => {
  db.prepare("DELETE FROM story_scene_transitions WHERE id = ?").run(req.params.transitionId);
  res.json({ ok: true });
});

// --------------------------------------------------- набор звука у сцены

/**
 * Набор пульта звука, привязанный к сцене: «из чего собран пульт для этого
 * места». Ссылка на готовый набор, а не свой список звуков, — один и тот же
 * «Таверна» пойдёт в десяток сцен, и собирать пульт заново под каждую значило
 * бы делать работу, которая уже сделана.
 *
 * Ровно один набор на сцену: PUT заменяет, а не добавляет. Два набора
 * одновременно пульт включить не может, и хранить второй было бы враньём.
 */
storyRouter.get("/scenes/:id/sound-set", (req, res) => {
  res.json(sceneSoundSet(Number(req.params.id)));
});

storyRouter.put("/scenes/:id/sound-set", (req, res) => {
  const setId = req.body?.sound_set_id == null ? null : Number(req.body.sound_set_id);
  const campaignId = req.body?.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableScene(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });

  db.prepare(
    "DELETE FROM generic_links WHERE from_type = 'scene' AND from_id = ? AND section = ?"
  ).run(target.id, SCENE_SOUND_SECTION);
  if (setId != null && Number.isFinite(setId)) {
    db.prepare(
      `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
       VALUES ('scene', ?, 'sound_set', ?, ?)`
    ).run(target.id, setId, SCENE_SOUND_SECTION);
  }
  res.json({ scene_id: target.id, sound: sceneSoundSet(target.id) });
});
