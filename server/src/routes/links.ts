import { Router } from "express";
import { db } from "../db/db";

export const linksRouter = Router();

// archivable: false — у таблицы нет колонки archived_at (записи компендиума
// удаляются насовсем), и запрос узлов не должен по ней фильтровать.
const NODE_TABLES: Record<string, { table: string; nameCol: string; archivable?: boolean }> = {
  campaign: { table: "campaigns", nameCol: "name" },
  setting: { table: "settings", nameCol: "name" },
  player: { table: "players", nameCol: "name" },
  character: { table: "characters", nameCol: "character_name" },
  location: { table: "setting_locations", nameCol: "name" },
  being: { table: "setting_beings", nameCol: "name" },
  artifact: { table: "artifacts", nameCol: "name" },
  community: { table: "setting_communities", nameCol: "name" },
  resource: { table: "resources", nameCol: "name" },
  mastering: { table: "mastering_notes", nameCol: "title" },
  scene: { table: "story_scenes", nameCol: "name" },
  adventure: { table: "story_arcs", nameCol: "name" },
  // entity_relations умеет ссылаться на записи компендиума («тот же монстр,
  // что в бестиарии»), и без этой строки такие связи молча пропадали из
  // графа: track() отбрасывал неизвестный тип вместе с ребром.
  compendium_entry: { table: "compendium_entries", nameCol: "name", archivable: false },
};

interface GraphNode {
  key: string;
  type: string;
  id: number;
  title: string;
}
interface GraphEdge {
  from: string;
  to: string;
  section: string | null;
  tone: string | null; // positive | negative | neutral | mixed | null (plain generic_links edge)
}

// Node types a `setting_id` graph filter can resolve down to. Types not
// listed here (player, resource, mastering, session, compendium_entry) are
// dropped entirely when the filter is active — they don't have an
// unambiguous single-setting home.
const SETTING_SCOPE_QUERIES: Record<string, string> = {
  being: "SELECT id FROM setting_beings WHERE setting_id = ?",
  community: "SELECT id FROM setting_communities WHERE setting_id = ?",
  location: "SELECT id FROM setting_locations WHERE setting_id = ?",
  artifact: "SELECT id FROM artifacts WHERE setting_id = ?",
  campaign: "SELECT id FROM campaigns WHERE setting_id = ?",
  character: "SELECT c.id FROM characters c JOIN campaigns ca ON ca.id = c.campaign_id WHERE ca.setting_id = ?",
  setting: "SELECT id FROM settings WHERE id = ?",
  // Only the setting's own scenes — a campaign's copy-on-write overrides
  // belong to that campaign's view, not to the setting-wide graph.
  scene: "SELECT id FROM story_scenes WHERE setting_id = ? AND campaign_id IS NULL",
  adventure: "SELECT id FROM story_arcs WHERE setting_id = ?",
};

// Node types a `campaign_id` graph filter resolves through the campaign
// itself. Всё остальное (существа, фракции, локации, артефакты) кампания
// наследует от своего сеттинга — см. buildScope: без этого граф кампании
// оставался почти пустым, хотя её содержание как раз в населении сеттинга.
const CAMPAIGN_SCOPE_QUERIES: Record<string, string> = {
  character: "SELECT id FROM characters WHERE campaign_id = ?",
  campaign: "SELECT id FROM campaigns WHERE id = ?",
  player: "SELECT player_id as id FROM campaign_roster WHERE campaign_id = ?",
  session: "SELECT id FROM sessions WHERE campaign_id = ?",
  // Сцены кампании — и собственные, и её copy-on-write копии сценариев.
  scene: "SELECT id FROM story_scenes WHERE campaign_id = ?",
};

interface ScopeQuery {
  sql: string;
  param: string;
}

/**
 * Какие узлы каждого типа попадают в выбранную область. Для сеттинга это
 * просто его собственные строки; для кампании — её строки (персонажи, игроки,
 * сцены) поверх строк сеттинга, которому она принадлежит. Возвращает null,
 * если область не задана: тогда граф глобальный и не сужается.
 */
function buildScope(campaignId?: string, settingId?: string): Map<string, ScopeQuery> | null {
  const scope = new Map<string, ScopeQuery>();
  if (campaignId) {
    const row = db.prepare("SELECT setting_id FROM campaigns WHERE id = ?").get(campaignId) as
      | { setting_id: number | null }
      | undefined;
    if (row?.setting_id) {
      for (const [type, sql] of Object.entries(SETTING_SCOPE_QUERIES)) {
        scope.set(type, { sql, param: String(row.setting_id) });
      }
    }
    // Свои строки кампании перекрывают наследованные от сеттинга: список
    // персонажей и сцен у кампании собственный, а не «все в сеттинге».
    for (const [type, sql] of Object.entries(CAMPAIGN_SCOPE_QUERIES)) {
      scope.set(type, { sql, param: campaignId });
    }
    return scope;
  }
  if (settingId) {
    for (const [type, sql] of Object.entries(SETTING_SCOPE_QUERIES)) {
      scope.set(type, { sql, param: settingId });
    }
    return scope;
  }
  return null;
}

linksRouter.get("/graph", (req, res) => {
  const { types, setting_id, campaign_id } = req.query as {
    types?: string;
    setting_id?: string;
    campaign_id?: string;
  };
  // Пустая строка — это «типы не выбраны», а не «фильтра нет»: снятые
  // галочки должны давать пустой граф, а не молча весь.
  const allowedTypes = types === undefined ? null : new Set(types.split(",").filter(Boolean));
  // campaign_id is the narrower scope, so it wins if both are given.
  const scopeQueries = buildScope(campaign_id, setting_id);

  const rawLinks = db
    .prepare("SELECT from_type, from_id, to_type, to_id, section FROM generic_links")
    .all() as { from_type: string; from_id: number; to_type: string; to_id: number; section: string | null }[];

  const rawRelations = db
    .prepare("SELECT from_type, from_id, to_type, to_id, tone, label FROM entity_relations")
    .all() as { from_type: string; from_id: number; to_type: string; to_id: number; tone: string; label: string }[];

  // Structural membership (who belongs to a faction) and habitat (who lives
  // where) links — not authored opinions like entity_relations, just
  // existing roster data, so they render as plain untoned edges.
  const rawMemberships = db
    .prepare("SELECT being_id, community_id FROM being_communities")
    .all() as { being_id: number; community_id: number }[];
  const rawHabitats = db
    .prepare("SELECT being_id, location_id FROM being_locations")
    .all() as { being_id: number; location_id: number }[];

  // Location nesting (a district inside a city, a room inside a building) —
  // same self-referencing parent_id used by the Geography tree.
  const rawLocationNesting = db
    .prepare("SELECT id, parent_id FROM setting_locations WHERE parent_id IS NOT NULL AND archived_at IS NULL")
    .all() as { id: number; parent_id: number }[];

  // Сообщество тоже где-то базируется — таблица симметрична being_locations,
  // но в граф до сих пор не попадала.
  const rawCommunityLocations = db
    .prepare("SELECT community_id, location_id FROM community_locations")
    .all() as { community_id: number; location_id: number }[];

  const edges: GraphEdge[] = [];
  const wanted = new Map<string, { type: string; id: number }>();

  // Отбор по типам живёт здесь, а не в каждом цикле: раньше ребро проходило,
  // если нужного типа был хотя бы один его конец, и узлы снятого типа всё
  // равно возвращались в граф — притянутые рёбрами от оставшихся. Тип, с
  // которого сняли галочку, теперь не даёт ключа, а значит и ребро с ним не
  // создаётся.
  const track = (type: string, id: number) => {
    if (type === "preproduction") type = "campaign"; // preproduction nodes collapse into their campaign
    if (!NODE_TABLES[type]) return null;
    if (allowedTypes && !allowedTypes.has(type)) return null;
    const key = `${type}:${id}`;
    wanted.set(key, { type, id });
    return key;
  };

  const connect = (
    fromType: string,
    fromId: number,
    toType: string,
    toId: number,
    section: string | null,
    tone: string | null
  ) => {
    const from = track(fromType, fromId);
    const to = track(toType, toId);
    if (from && to && from !== to) edges.push({ from, to, section, tone });
  };

  for (const l of rawLinks) connect(l.from_type, l.from_id, l.to_type, l.to_id, l.section, null);
  for (const r of rawRelations)
    connect(r.from_type, r.from_id, r.to_type, r.to_id, r.label || null, r.tone);
  for (const m of rawMemberships)
    connect("community", m.community_id, "being", m.being_id, "участник", null);
  for (const h of rawHabitats) connect("location", h.location_id, "being", h.being_id, "обитает", null);
  for (const n of rawLocationNesting)
    connect("location", n.parent_id, "location", n.id, "вложенная локация", null);
  for (const c of rawCommunityLocations)
    connect("location", c.location_id, "community", c.community_id, "базируется", null);

  const byType = new Map<string, number[]>();
  for (const { type, id } of wanted.values()) {
    const list = byType.get(type) ?? [];
    list.push(id);
    byType.set(type, list);
  }

  let nodes: GraphNode[] = [];
  for (const [type, ids] of byType) {
    if (scopeQueries && !scopeQueries.has(type)) continue; // type has no defined home within this scope
    const { table, nameCol, archivable = true } = NODE_TABLES[type];
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, ${nameCol} as name FROM ${table} WHERE id IN (${placeholders})` +
          (archivable ? " AND archived_at IS NULL" : "")
      )
      .all(...ids) as { id: number; name: string }[];
    for (const r of rows) {
      nodes.push({ key: `${type}:${r.id}`, type, id: r.id, title: r.name });
    }
  }

  if (scopeQueries) {
    const allowedByType = new Map<string, Set<number>>();
    for (const type of new Set(nodes.map((n) => n.type))) {
      const query = scopeQueries.get(type);
      if (!query) continue;
      const rows = db.prepare(query.sql).all(query.param) as { id: number }[];
      allowedByType.set(type, new Set(rows.map((r) => r.id)));
    }
    nodes = nodes.filter((n) => allowedByType.get(n.type)?.has(n.id));
  }

  const nodeKeys = new Set(nodes.map((n) => n.key));
  res.json({
    nodes,
    edges: edges.filter((e) => nodeKeys.has(e.from) && nodeKeys.has(e.to)),
  });
});

// Sessions whose Задумка/Основные события text @-mentions this entity —
// backs the "Упоминания" tab on Being/Location/Community/Artifact pages.
// syncMentionLinks always writes from_type = the entity that OWNS the text
// (always "session" here, since idea_notes/main_events go through
// EditableTextCard), so this only needs to look in one direction.
linksRouter.get("/mentioning-sessions", (req, res) => {
  const { type, id } = req.query as { type?: string; id?: string };
  if (!type || !id) return res.status(400).json({ error: "type and id are required" });
  const rows = db
    .prepare(
      `SELECT s.id, s.date, s.title, s.campaign_id, c.name as campaign_name,
              (SELECT COUNT(*) FROM sessions s2
                 WHERE s2.campaign_id = s.campaign_id AND s2.archived_at IS NULL
                   AND s2.date <= s.date) as session_number
       FROM generic_links gl
       JOIN sessions s ON s.id = gl.from_id
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE gl.from_type = 'session' AND gl.to_type = ? AND gl.to_id = ? AND gl.section = 'mention'
         AND s.archived_at IS NULL
       ORDER BY s.date DESC`
    )
    .all(type, id);
  res.json(rows);
});

linksRouter.get("/", (req, res) => {
  const { type, id, section } = req.query as { type?: string; id?: string; section?: string };
  if (!type || !id) return res.status(400).json({ error: "type and id are required" });
  const rows = section
    ? db
        .prepare(
          `SELECT * FROM generic_links WHERE ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)) AND section = ?`
        )
        .all(type, id, type, id, section)
    : db
        .prepare(
          `SELECT * FROM generic_links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)`
        )
        .all(type, id, type, id);
  res.json(rows);
});

linksRouter.post("/", (req, res) => {
  const { from_type, from_id, to_type, to_id, section, origin } = req.body as {
    from_type: string;
    from_id: number;
    to_type: string;
    to_id: number;
    section?: string;
    origin?: string;
  };
  if (!from_type || !from_id || !to_type || !to_id)
    return res.status(400).json({ error: "from_type, from_id, to_type, to_id are required" });
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section, origin) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(from_type, from_id, to_type, to_id, section ?? null, origin === "live" ? "live" : "planned");
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

linksRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM generic_links WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
