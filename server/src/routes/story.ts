import { Router } from "express";
import { db } from "../db/db";

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
  "canvas_x",
  "canvas_y",
  "arc_id",
] as const;

interface SceneRow {
  id: number;
  setting_id: number;
  arc_id: number | null;
  campaign_id: number | null;
  source_scene_id: number | null;
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
function resolveWritableScene(sceneId: number, campaignId: number | null): SceneRow | null {
  const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(sceneId) as
    | SceneRow
    | undefined;
  if (!scene) return null;
  if (campaignId == null || scene.campaign_id === campaignId) return scene;

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
function cloneSceneForCampaign(sceneId: number, campaignId: number): SceneRow {
  const clone = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO story_scenes
           (setting_id, arc_id, campaign_id, source_scene_id, name, kind, summary, read_aloud,
            whats_happening, entry_condition, outcomes, hidden_from_players, position,
            canvas_x, canvas_y)
         SELECT setting_id, arc_id, ?, id, name, kind, summary, read_aloud,
                whats_happening, entry_condition, outcomes, hidden_from_players, position,
                canvas_x, canvas_y
         FROM story_scenes WHERE id = ?`
      )
      .run(campaignId, sceneId);
    const newId = Number(info.lastInsertRowid);

    db.prepare(
      `INSERT INTO story_scene_checks (scene_id, what, difficulty, on_success, on_failure, position)
       SELECT ?, what, difficulty, on_success, on_failure, position
       FROM story_scene_checks WHERE scene_id = ?`
    ).run(newId, sceneId);
    db.prepare(
      `INSERT INTO story_scene_rewards (scene_id, what, where_found, notes, artifact_id, position)
       SELECT ?, what, where_found, notes, artifact_id, position
       FROM story_scene_rewards WHERE scene_id = ?`
    ).run(newId, sceneId);
    // to_scene_id keeps pointing at the setting's originals; the list
    // endpoints map those through the override table when displaying.
    db.prepare(
      `INSERT OR IGNORE INTO story_scene_transitions (from_scene_id, to_scene_id, label, position)
       SELECT ?, to_scene_id, label, position
       FROM story_scene_transitions WHERE from_scene_id = ?`
    ).run(newId, sceneId);
    db.prepare(
      `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section, origin)
       SELECT 'scene', ?, to_type, to_id, section, origin
       FROM generic_links WHERE from_type = 'scene' AND from_id = ?`
    ).run(newId, sceneId);

    return db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(newId) as SceneRow;
  });
  return clone();
}

function sceneExtras(sceneId: number) {
  return {
    checks: db
      .prepare("SELECT * FROM story_scene_checks WHERE scene_id = ? ORDER BY position, id")
      .all(sceneId),
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
  db.prepare("UPDATE story_scenes SET arc_id = ? WHERE setting_id = ? AND arc_id IS NULL").run(
    id,
    settingId
  );
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
              AND sc.archived_at IS NULL
              AND s.campaign_id IS NULL AND s.archived_at IS NULL)`;
}

/** Глав у приключения: у книжного их пять-шесть, у самодельного обычно ноль. */
function chapterCountSql(alias: string) {
  return `(SELECT COUNT(*) FROM story_arcs c
            WHERE c.parent_id = ${alias}.id AND c.archived_at IS NULL)`;
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
       WHERE a.setting_id = ? AND a.archived_at IS NULL
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
       WHERE a.parent_id = ? AND a.archived_at IS NULL ORDER BY a.position, a.id`
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

  const milestones = db
    .prepare(
      `SELECT m.*, s.name as scene_name FROM story_milestones m
       LEFT JOIN story_scenes s ON s.id = m.scene_id
       WHERE m.arc_id = ? ORDER BY m.position, m.id`
    )
    .all(arc.id) as { id: number }[];
  const secrets = db
    .prepare("SELECT * FROM story_secrets WHERE arc_id = ? ORDER BY position, id")
    .all(arc.id) as { id: number }[];
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

  res.json({
    ...arc,
    chapters,
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

storyRouter.put("/arcs/:id", (req, res) => {
  const arc = db.prepare("SELECT is_default FROM story_arcs WHERE id = ?").get(req.params.id) as
    | { is_default: number }
    | undefined;
  if (!arc) return res.status(404).json({ error: "not found" });
  // The auto-created bucket keeps its name so it stays recognizable.
  if (arc.is_default === 1 && req.body.name !== undefined) {
    return res.status(400).json({ error: "Стандартное приключение нельзя переименовать" });
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of ARC_FIELDS) {
    if (req.body[field] === undefined) continue;
    sets.push(`${field} = ?`);
    values.push(req.body[field]);
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE story_arcs SET ${sets.join(", ")} WHERE id = ?`).run(...values, req.params.id);
  }
  res.json(db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(req.params.id));
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
  const { campaign_id, revealed, note } = req.body as {
    campaign_id: number;
    revealed?: boolean;
    note?: string;
  };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  db.prepare(
    `INSERT INTO campaign_secret_state (campaign_id, secret_id, revealed, note, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(campaign_id, secret_id) DO UPDATE SET
       revealed = excluded.revealed, note = excluded.note, updated_at = datetime('now')`
  ).run(campaign_id, req.params.secretId, revealed ? 1 : 0, note ?? "");
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
    return res.json(originals.map((s) => ({ ...s, is_override: false, state: null })));
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
    ...s,
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
  if (campaignId != null && scene.campaign_id == null) {
    shown = (overrideMap(campaignId, scene.setting_id).get(scene.id) ?? scene) as SceneRow;
  }
  res.json({
    ...shown,
    is_override: shown.campaign_id != null && shown.source_scene_id != null,
    campaign_only: shown.campaign_id != null && shown.source_scene_id == null,
    state:
      campaignId != null
        ? db
            .prepare("SELECT status, note FROM campaign_scene_state WHERE campaign_id = ? AND scene_id = ?")
            .get(campaignId, shown.id) ?? null
        : null,
    ...sceneExtras(shown.id),
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
  db.prepare("UPDATE story_scenes SET archived_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
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

// ------------------------------------------------- checks / rewards / edges

storyRouter.post("/scenes/:id/checks", (req, res) => {
  const campaignId = req.body.campaign_id != null ? Number(req.body.campaign_id) : null;
  const target = resolveWritableScene(Number(req.params.id), campaignId);
  if (!target) return res.status(404).json({ error: "not found" });
  const position =
    (db.prepare("SELECT MAX(position) as m FROM story_scene_checks WHERE scene_id = ?").get(target.id) as {
      m: number | null;
    }).m ?? -1;
  db.prepare(
    "INSERT INTO story_scene_checks (scene_id, what, difficulty, on_success, on_failure, position) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    target.id,
    req.body.what ?? "",
    req.body.difficulty ?? "",
    req.body.on_success ?? "",
    req.body.on_failure ?? "",
    position + 1
  );
  res.status(201).json(sceneExtras(target.id).checks);
});

storyRouter.put("/checks/:checkId", (req, res) => {
  const { what, difficulty, on_success, on_failure } = req.body as Record<string, string | undefined>;
  db.prepare(
    `UPDATE story_scene_checks SET
       what = COALESCE(?, what), difficulty = COALESCE(?, difficulty),
       on_success = COALESCE(?, on_success), on_failure = COALESCE(?, on_failure)
     WHERE id = ?`
  ).run(what ?? null, difficulty ?? null, on_success ?? null, on_failure ?? null, req.params.checkId);
  res.json(db.prepare("SELECT * FROM story_scene_checks WHERE id = ?").get(req.params.checkId));
});

storyRouter.delete("/checks/:checkId", (req, res) => {
  db.prepare("DELETE FROM story_scene_checks WHERE id = ?").run(req.params.checkId);
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
