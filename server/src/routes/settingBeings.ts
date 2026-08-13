import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { beingFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";

export const settingBeingsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

export function withAvatarUrl<
  T extends {
    avatar_image_path?: string | null;
    thumbnail_image_path?: string | null;
    tags?: string | string[];
    aliases?: string | string[];
  }
>(row: T) {
  return {
    ...row,
    avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
    tags: parseTags(row.tags),
    // Синонимы лежат в базе JSON-строкой, наружу отдаются массивом — как теги.
    aliases: parseTags(row.aliases),
  };
}

function parseTags(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function getLocations(beingId: string | number) {
  return db
    .prepare(
      `SELECT l.id, l.name FROM being_locations bl
       JOIN setting_locations l ON l.id = bl.location_id
       WHERE bl.being_id = ? AND l.archived_at IS NULL ORDER BY l.name`
    )
    .all(beingId);
}

// Monster templates this being points at, across every system's compendium
// (бестиарий entries mostly — see being_compendium_links in schema.sql).
export function getCompendiumLinks(beingId: string | number) {
  return db
    .prepare(
      `SELECT ce.id, ce.name, ce.system_id, sy.name as system_name
       FROM being_compendium_links bcl
       JOIN compendium_entries ce ON ce.id = bcl.compendium_entry_id
       LEFT JOIN systems sy ON sy.id = ce.system_id
       WHERE bcl.being_id = ? ORDER BY sy.name, ce.name`
    )
    .all(beingId);
}

export interface CreatureMeta {
  size: string;
  creatureType: string;
  alignment: string;
}

// Small gray "Тип существа, размер, мировоззрение" line shown under a
// being's name — pulled from its dnd_creature statblock (if any) rather than
// stored redundantly on setting_beings, so it stays in sync with whatever
// the statblock actually says. Batched (one query for a whole list) so list
// endpoints (Население, Обитатели, Представители) don't do it per-row.
export function getCreatureMetaByOwner(ownerType: string, ownerIds: (number | string)[]): Map<number, CreatureMeta> {
  const map = new Map<number, CreatureMeta>();
  if (ownerIds.length === 0) return map;
  const placeholders = ownerIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT owner_id, content FROM statblocks
       WHERE owner_type = ? AND format = 'dnd_creature' AND owner_id IN (${placeholders})`
    )
    .all(ownerType, ...ownerIds) as { owner_id: number; content: string }[];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as Partial<CreatureMeta>;
      const meta: CreatureMeta = {
        size: typeof parsed.size === "string" ? parsed.size : "",
        creatureType: typeof parsed.creatureType === "string" ? parsed.creatureType : "",
        alignment: typeof parsed.alignment === "string" ? parsed.alignment : "",
      };
      if (meta.size || meta.creatureType || meta.alignment) map.set(r.owner_id, meta);
    } catch {
      /* malformed statblock content — skip */
    }
  }
  return map;
}

settingBeingsRouter.get("/", (req, res) => {
  const { setting_id, category, exclude_category, location_id, q } = req.query as {
    setting_id?: string;
    category?: string;
    exclude_category?: string;
    location_id?: string;
    q?: string;
  };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  const clauses = ["b.setting_id = @setting_id", "b.archived_at IS NULL"];
  const params: Record<string, string> = { setting_id };
  if (category) {
    clauses.push("b.category = @category");
    params.category = category;
  }
  // Население's "Все" tab means "every *named* personality" — the бестиарий
  // lives in its own subsection, so that list asks to exclude it rather than
  // naming the three named categories explicitly.
  if (exclude_category) {
    clauses.push("b.category != @exclude_category");
    params.exclude_category = exclude_category;
  }
  if (location_id) {
    // Requirement 1: filtering by a location also surfaces beings assigned to
    // any location nested underneath it (А → В → С means a being in С shows
    // up when filtering by А or В too), not just an exact location match.
    clauses.push(`b.id IN (
      SELECT being_id FROM being_locations WHERE location_id IN (
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM setting_locations WHERE id = @location_id
          UNION ALL
          SELECT sl.id FROM setting_locations sl JOIN descendants d ON sl.parent_id = d.id
        )
        SELECT id FROM descendants
      )
    )`);
    params.location_id = location_id;
  }
  if (q && q.trim()) {
    // "Connected in some way": direct name match, related to a matching
    // being (either direction), a member of a matching community, or
    // sharing a location with a matching being.
    clauses.push(`(
      lower_u(b.name) LIKE @q
      OR b.id IN (
        SELECT r.being_b_id FROM being_relations r
        JOIN setting_beings mb ON mb.id = r.being_a_id WHERE lower_u(mb.name) LIKE @q
        UNION
        SELECT r.being_a_id FROM being_relations r
        JOIN setting_beings mb ON mb.id = r.being_b_id WHERE lower_u(mb.name) LIKE @q
      )
      OR b.id IN (
        SELECT bc.being_id FROM being_communities bc
        JOIN setting_communities mc ON mc.id = bc.community_id WHERE lower_u(mc.name) LIKE @q
      )
      OR b.id IN (
        SELECT bl.being_id FROM being_locations bl
        WHERE bl.location_id IN (
          SELECT bl2.location_id FROM being_locations bl2
          JOIN setting_beings mb ON mb.id = bl2.being_id WHERE lower_u(mb.name) LIKE @q
        )
      )
    )`);
    // lower_u — юникодный lower из db.ts: встроенные LIKE и LOWER в SQLite
    // приводят регистр только у латиницы, и «мирт» не находил «Мирт».
    params.q = `%${q.trim().toLowerCase()}%`;
  }
  const rows = db
    .prepare(
      `SELECT b.*, m.name as base_monster_name FROM setting_beings b
       LEFT JOIN compendium_entries m ON m.id = b.base_monster_id
       WHERE ${clauses.join(" AND ")} ORDER BY b.name`
    )
    .all(params) as { id: number }[];
  const creatureMeta = getCreatureMetaByOwner(
    "being",
    rows.map((r) => r.id)
  );
  res.json(
    rows.map((r) => ({
      ...withAvatarUrl(r as { avatar_image_path?: string | null }),
      locations: getLocations(r.id),
      creature_meta: creatureMeta.get(r.id) ?? null,
    }))
  );
});

settingBeingsRouter.get("/:id", (req, res) => {
  const row = db
    .prepare(
      `SELECT b.*, m.name as base_monster_name FROM setting_beings b
       LEFT JOIN compendium_entries m ON m.id = b.base_monster_id
       WHERE b.id = ?`
    )
    .get(req.params.id) as
    | { avatar_image_path: string | null; folder_path: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const events = db
    .prepare(
      `SELECT be.*, s.date as session_date, c.name as campaign_name
       FROM being_events be
       LEFT JOIN sessions s ON s.id = be.session_id
       LEFT JOIN campaigns c ON c.id = s.campaign_id
       WHERE be.being_id = ? ORDER BY be.created_at DESC`
    )
    .all(req.params.id);
  const relations = db
    .prepare(
      `SELECT br.*, ba.name as being_a_name, bb.name as being_b_name
       FROM being_relations br
       JOIN setting_beings ba ON ba.id = br.being_a_id
       JOIN setting_beings bb ON bb.id = br.being_b_id
       WHERE br.being_a_id = ? OR br.being_b_id = ?
       ORDER BY br.created_at DESC`
    )
    .all(req.params.id, req.params.id);
  const communities = db
    .prepare(
      `SELECT sc.id, sc.name FROM being_communities bc
       JOIN setting_communities sc ON sc.id = bc.community_id
       WHERE bc.being_id = ? AND sc.archived_at IS NULL
       ORDER BY sc.name`
    )
    .all(req.params.id);
  const importantDates = db
    .prepare("SELECT * FROM important_dates WHERE owner_type = 'being' AND owner_id = ? ORDER BY created_at")
    .all(req.params.id);
  const chapters = db
    .prepare(
      `SELECT bc.*, c.name as campaign_name
       FROM being_chapters bc
       LEFT JOIN campaigns c ON c.id = bc.campaign_id
       WHERE bc.being_id = ? ORDER BY bc.created_at`
    )
    .all(req.params.id);
  res.json({
    ...withAvatarUrl(row),
    events,
    relations,
    communities,
    compendium_links: getCompendiumLinks(req.params.id),
    locations: getLocations(req.params.id),
    creature_meta: getCreatureMetaByOwner("being", [Number(req.params.id)]).get(Number(req.params.id)) ?? null,
    important_dates: importantDates,
    chapters,
  });
});

settingBeingsRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  const being = db
    .prepare("SELECT folder_path, avatar_image_path FROM setting_beings WHERE id = ?")
    .get(req.params.id) as { folder_path: string; avatar_image_path: string | null } | undefined;
  if (!being) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(being.folder_path, `avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, being.avatar_image_path, "avatar");

  db.prepare("UPDATE setting_beings SET avatar_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withAvatarUrl({ avatar_image_path: target }));
});

// Wide thumbnail shown in the Setting's Население list — cropped
// independently from the square avatar, since the list card isn't square.
settingBeingsRouter.post("/:id/thumbnail", upload.single("file"), async (req, res) => {
  const being = db
    .prepare("SELECT folder_path, thumbnail_image_path FROM setting_beings WHERE id = ?")
    .get(req.params.id) as { folder_path: string; thumbnail_image_path: string | null } | undefined;
  if (!being) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(being.folder_path, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, being.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE setting_beings SET thumbnail_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withAvatarUrl({ thumbnail_image_path: target }));
});

settingBeingsRouter.post("/", (req, res) => {
  const {
    setting_id,
    name,
    category,
    location_id,
    statblock_short,
    statblock_full,
    history,
    behavior,
    tags,
    community_ids,
    base_monster_id,
  } = req.body as {
    setting_id: number;
    name: string;
    category?: string;
    location_id?: number | null;
    statblock_short?: string;
    statblock_full?: string;
    history?: string;
    behavior?: string;
    tags?: string[];
    community_ids?: number[];
    base_monster_id?: number | null;
  };
  if (!setting_id || !name)
    return res.status(400).json({ error: "setting_id and name are required" });
  const setting = db
    .prepare("SELECT folder_path FROM settings WHERE id = ?")
    .get(setting_id) as { folder_path: string } | undefined;
  if (!setting) return res.status(404).json({ error: "setting not found" });
  const folder = beingFolder(setting.folder_path, name);

  const info = db
    .prepare(
      `INSERT INTO setting_beings
         (setting_id, name, category, location_id, statblock_short, statblock_full, history, behavior, folder_path, tags, base_monster_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      setting_id,
      name,
      category ?? "bestiary",
      location_id ?? null,
      statblock_short ?? "",
      statblock_full ?? "",
      history ?? "",
      behavior ?? "",
      folder,
      JSON.stringify(tags ?? []),
      base_monster_id ?? null
    );
  if (location_id) {
    db.prepare(
      "INSERT OR IGNORE INTO being_locations (being_id, location_id) VALUES (?, ?)"
    ).run(info.lastInsertRowid, location_id);
  }
  if (community_ids && community_ids.length > 0) {
    const insertCommunity = db.prepare(
      "INSERT OR IGNORE INTO being_communities (being_id, community_id) VALUES (?, ?)"
    );
    for (const communityId of community_ids) insertCommunity.run(info.lastInsertRowid, communityId);
  }
  // "On the basis of" a Бестиарий template: clone its statblock(s) in as an
  // editable starting point — a snapshot, not a live link, so later edits to
  // the template or this being don't affect one another.
  if (base_monster_id) {
    db.prepare(
      `INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note, theme, density)
       SELECT 'being', ?, kind, format, content, note, theme, density
       FROM statblocks WHERE owner_type = 'compendium_entry' AND owner_id = ?`
    ).run(info.lastInsertRowid, base_monster_id);
  }
  res
    .status(201)
    .json(
      db
        .prepare(
          `SELECT b.*, m.name as base_monster_name FROM setting_beings b
           LEFT JOIN compendium_entries m ON m.id = b.base_monster_id
           WHERE b.id = ?`
        )
        .get(info.lastInsertRowid)
    );
});

settingBeingsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM setting_beings WHERE id = ?")
    .get(req.params.id) as { folder_path: string; name: string; location_id: number | null } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });

  const {
    name,
    category,
    statblock_short,
    statblock_full,
    history,
    behavior,
    description,
    tags,
    base_monster_id,
    short_name,
    aliases,
    name_original,
  } = req.body as {
    name?: string;
    category?: string;
    statblock_short?: string;
    statblock_full?: string;
    history?: string;
    behavior?: string;
    description?: string;
    tags?: string[];
    base_monster_id?: number | null;
    short_name?: string;
    aliases?: string[];
    name_original?: string;
  };
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  db.prepare(
    `UPDATE setting_beings SET
       name = COALESCE(?, name), category = COALESCE(?, category),
       statblock_short = COALESCE(?, statblock_short),
       statblock_full = COALESCE(?, statblock_full),
       history = COALESCE(?, history), behavior = COALESCE(?, behavior),
       description = COALESCE(?, description),
       tags = COALESCE(?, tags),
       base_monster_id = CASE WHEN ? THEN ? ELSE base_monster_id END,
       short_name = CASE WHEN ? THEN ? ELSE short_name END,
       aliases = COALESCE(?, aliases),
       name_original = COALESCE(?, name_original),
       folder_path = ?
     WHERE id = ?`
  ).run(
    name ?? null,
    category ?? null,
    statblock_short ?? null,
    statblock_full ?? null,
    history ?? null,
    behavior ?? null,
    description ?? null,
    tags ? JSON.stringify(tags) : null,
    base_monster_id !== undefined ? 1 : 0,
    base_monster_id ?? null,
    short_name !== undefined ? 1 : 0,
    short_name ?? null,
    aliases ? JSON.stringify(aliases) : null,
    name_original ?? null,
    folderPath,
    req.params.id
  );
  res.json(
    db
      .prepare(
        `SELECT b.*, m.name as base_monster_name FROM setting_beings b
         LEFT JOIN compendium_entries m ON m.id = b.base_monster_id
         WHERE b.id = ?`
      )
      .get(req.params.id)
  );
});

settingBeingsRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE setting_beings SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

settingBeingsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE setting_beings SET archived_at = NULL WHERE id = ?").run(
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM setting_beings WHERE id = ?").get(req.params.id));
});

// Current-situation timeline entries, optionally tied to a session
settingBeingsRouter.post("/:id/events", (req, res) => {
  const { title, description, session_id } = req.body as {
    title: string;
    description?: string;
    session_id?: number | null;
  };
  if (!title) return res.status(400).json({ error: "title is required" });
  const info = db
    .prepare(
      "INSERT INTO being_events (being_id, session_id, title, description) VALUES (?, ?, ?, ?)"
    )
    .run(req.params.id, session_id ?? null, title, description ?? "");
  res
    .status(201)
    .json(db.prepare("SELECT * FROM being_events WHERE id = ?").get(info.lastInsertRowid));
});

settingBeingsRouter.delete("/events/:eventId", (req, res) => {
  db.prepare("DELETE FROM being_events WHERE id = ?").run(req.params.eventId);
  res.json({ ok: true });
});

// Articles for История/Поведение/Текущая ситуация. Only Текущая ситуация
// (section = "current_situation") uses campaign_id/important; the other two
// sections leave them at their column defaults (NULL / 0).
settingBeingsRouter.post("/:id/chapters", (req, res) => {
  const { section, title, content, campaign_id, important } = req.body as {
    section: string;
    title?: string;
    content?: string;
    campaign_id?: number | null;
    important?: boolean;
  };
  if (!section) return res.status(400).json({ error: "section is required" });
  const info = db
    .prepare(
      "INSERT INTO being_chapters (being_id, section, title, content, campaign_id, important) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(req.params.id, section, title ?? "", content ?? "", campaign_id ?? null, important ? 1 : 0);
  res.status(201).json(
    db
      .prepare(
        `SELECT bc.*, c.name as campaign_name FROM being_chapters bc
         LEFT JOIN campaigns c ON c.id = bc.campaign_id
         WHERE bc.id = ?`
      )
      .get(info.lastInsertRowid)
  );
});

settingBeingsRouter.put("/chapters/:chapterId", (req, res) => {
  const { title, content, campaign_id, important, visible_to_players } = req.body as {
    title?: string;
    content?: string;
    campaign_id?: number | null;
    important?: boolean;
    visible_to_players?: boolean;
  };
  // campaign_id needs a real tri-state (unset in the request vs. explicitly
  // cleared to "no campaign"), which COALESCE can't express — build the SET
  // clause conditionally instead of always writing the column.
  db.prepare(
    `UPDATE being_chapters SET
       title = COALESCE(?, title),
       content = COALESCE(?, content),
       campaign_id = CASE WHEN ? THEN ? ELSE campaign_id END,
       important = COALESCE(?, important),
       visible_to_players = COALESCE(?, visible_to_players)
     WHERE id = ?`
  ).run(
    title ?? null,
    content ?? null,
    campaign_id !== undefined ? 1 : 0,
    campaign_id ?? null,
    important === undefined ? null : important ? 1 : 0,
    visible_to_players === undefined ? null : visible_to_players ? 1 : 0,
    req.params.chapterId
  );
  res.json(
    db
      .prepare(
        `SELECT bc.*, c.name as campaign_name FROM being_chapters bc
         LEFT JOIN campaigns c ON c.id = bc.campaign_id
         WHERE bc.id = ?`
      )
      .get(req.params.chapterId)
  );
});

settingBeingsRouter.delete("/chapters/:chapterId", (req, res) => {
  db.prepare("DELETE FROM being_chapters WHERE id = ?").run(req.params.chapterId);
  res.json({ ok: true });
});

// Relations between two beings (e.g. "Ларри --сын и мать-- Чичи")
settingBeingsRouter.post("/:id/relations", (req, res) => {
  const { other_being_id, relation_type, description } = req.body as {
    other_being_id: number;
    relation_type?: string;
    description?: string;
  };
  if (!other_being_id)
    return res.status(400).json({ error: "other_being_id is required" });
  const info = db
    .prepare(
      "INSERT INTO being_relations (being_a_id, being_b_id, relation_type, description) VALUES (?, ?, ?, ?)"
    )
    .run(req.params.id, other_being_id, relation_type ?? "", description ?? "");
  res
    .status(201)
    .json(db.prepare("SELECT * FROM being_relations WHERE id = ?").get(info.lastInsertRowid));
});

settingBeingsRouter.put("/relations/:relationId", (req, res) => {
  const { relation_type, description } = req.body as {
    relation_type?: string;
    description?: string;
  };
  db.prepare(
    "UPDATE being_relations SET relation_type = COALESCE(?, relation_type), description = COALESCE(?, description) WHERE id = ?"
  ).run(relation_type ?? null, description ?? null, req.params.relationId);
  res.json(
    db.prepare("SELECT * FROM being_relations WHERE id = ?").get(req.params.relationId)
  );
});

settingBeingsRouter.delete("/relations/:relationId", (req, res) => {
  db.prepare("DELETE FROM being_relations WHERE id = ?").run(req.params.relationId);
  res.json({ ok: true });
});

// Community (people/culture) membership — replace the full set on each save.
settingBeingsRouter.put("/:id/communities", (req, res) => {
  const { community_ids } = req.body as { community_ids: number[] };
  db.prepare("DELETE FROM being_communities WHERE being_id = ?").run(req.params.id);
  const insert = db.prepare(
    "INSERT INTO being_communities (being_id, community_id) VALUES (?, ?)"
  );
  for (const communityId of community_ids ?? []) {
    insert.run(req.params.id, communityId);
  }
  const communities = db
    .prepare(
      `SELECT sc.id, sc.name FROM being_communities bc
       JOIN setting_communities sc ON sc.id = bc.community_id
       WHERE bc.being_id = ? ORDER BY sc.name`
    )
    .all(req.params.id);
  res.json(communities);
});

// Habitats ("Места обитания") — a being can live in several locations.
settingBeingsRouter.post("/:id/locations", (req, res) => {
  const { location_id } = req.body as { location_id: number };
  if (!location_id) return res.status(400).json({ error: "location_id is required" });
  db.prepare(
    "INSERT OR IGNORE INTO being_locations (being_id, location_id) VALUES (?, ?)"
  ).run(req.params.id, location_id);
  res.json(getLocations(req.params.id));
});

settingBeingsRouter.delete("/:id/locations/:locationId", (req, res) => {
  db.prepare(
    "DELETE FROM being_locations WHERE being_id = ? AND location_id = ?"
  ).run(req.params.id, req.params.locationId);
  res.json({ ok: true });
});

// Compendium monster templates linked to this being — many-to-many, so one
// бестиарий entry can carry the D&D statblock and another system's version
// of the same creature side by side.
settingBeingsRouter.post("/:id/compendium-links", (req, res) => {
  const { compendium_entry_id } = req.body as { compendium_entry_id: number };
  if (!compendium_entry_id) return res.status(400).json({ error: "compendium_entry_id is required" });
  db.prepare(
    "INSERT OR IGNORE INTO being_compendium_links (being_id, compendium_entry_id) VALUES (?, ?)"
  ).run(req.params.id, compendium_entry_id);
  res.json(getCompendiumLinks(req.params.id));
});

settingBeingsRouter.delete("/:id/compendium-links/:entryId", (req, res) => {
  db.prepare(
    "DELETE FROM being_compendium_links WHERE being_id = ? AND compendium_entry_id = ?"
  ).run(req.params.id, req.params.entryId);
  res.json(getCompendiumLinks(req.params.id));
});

// Important dates ("Важные даты") — recurring or one-off in-world dates
// that get surfaced on the setting's calendar and its campaigns' calendars.
settingBeingsRouter.post("/:id/important-dates", (req, res) => {
  const { title, recurrence, year, month, day } = req.body as {
    title: string;
    recurrence: string;
    year?: number | null;
    month?: number | null;
    day: number;
  };
  if (!title || day == null) return res.status(400).json({ error: "title and day are required" });
  const info = db
    .prepare(
      `INSERT INTO important_dates (owner_type, owner_id, title, recurrence, year, month, day)
       VALUES ('being', ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, title, recurrence || "once", year ?? null, month ?? null, day);
  res.status(201).json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(info.lastInsertRowid));
});

settingBeingsRouter.put("/important-dates/:dateId", (req, res) => {
  const { title, recurrence, year, month, day } = req.body as {
    title?: string;
    recurrence?: string;
    year?: number | null;
    month?: number | null;
    day?: number;
  };
  db.prepare(
    `UPDATE important_dates SET
       title = COALESCE(?, title), recurrence = COALESCE(?, recurrence),
       year = ?, month = ?, day = COALESCE(?, day)
     WHERE id = ?`
  ).run(title ?? null, recurrence ?? null, year ?? null, month ?? null, day ?? null, req.params.dateId);
  res.json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(req.params.dateId));
});

settingBeingsRouter.delete("/important-dates/:dateId", (req, res) => {
  db.prepare("DELETE FROM important_dates WHERE id = ?").run(req.params.dateId);
  res.json({ ok: true });
});
