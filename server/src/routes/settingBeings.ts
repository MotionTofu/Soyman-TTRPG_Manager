import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { beingFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";

export const settingBeingsRouter = Router();
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const ALLOWED_IMAGE_MIMES = /^image\/(jpeg|png|gif|webp|avif)$/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

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

export function getCommunities(beingId: string | number) {
  return db
    .prepare(
      `SELECT c.id, c.name FROM being_communities bc
       JOIN setting_communities c ON c.id = bc.community_id
       WHERE bc.being_id = ? AND c.archived_at IS NULL ORDER BY c.name`
    )
    .all(beingId);
}

export function getCommunityCountsByOwner(ownerIds: (number | string)[]): Map<number, number> {
  const map = new Map<number, number>();
  if (ownerIds.length === 0) return map;
  const placeholders = ownerIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT being_id, COUNT(*) as cnt FROM being_communities WHERE being_id IN (${placeholders}) GROUP BY being_id`
    )
    .all(...ownerIds) as { being_id: number; cnt: number }[];
  for (const r of rows) map.set(r.being_id, r.cnt);
  return map;
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

// Сколько карточек статблока заведено у существа — по этому числу список
// Населения помечает значком тех, у кого статблок вообще есть. Считаются
// статблоки любого формата: у существа их может быть несколько (короткий и
// полный, разные системы), а для пометки важно лишь «хотя бы один».
// Батчем, как и creature_meta: списки не должны опрашивать базу построчно.
export function getStatblockCountsByOwner(
  ownerType: string,
  ownerIds: (number | string)[]
): Map<number, number> {
  const map = new Map<number, number>();
  if (ownerIds.length === 0) return map;
  const placeholders = ownerIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT owner_id, COUNT(*) as count FROM statblocks
       WHERE owner_type = ? AND owner_id IN (${placeholders})
       GROUP BY owner_id`
    )
    .all(ownerType, ...ownerIds) as { owner_id: number; count: number }[];
  for (const r of rows) map.set(r.owner_id, r.count);
  return map;
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
  const { setting_id, category, exclude_category, location_id, community_id, q, sort, dir } = req.query as {
    setting_id?: string;
    category?: string;
    exclude_category?: string;
    location_id?: string;
    community_id?: string;
    q?: string;
    sort?: string;
    dir?: string;
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
  if (location_id === "none") {
    // «Без локации» — ни одной привязки к живой локации. Архивированные
    // локации не считаются: getLocations их тоже не отдаёт, так что существо
    // с единственной архивной привязкой в интерфейсе выглядит безлокационным.
    clauses.push(`b.id NOT IN (
      SELECT bl.being_id FROM being_locations bl
      JOIN setting_locations l ON l.id = bl.location_id
      WHERE l.archived_at IS NULL
    )`);
  } else if (location_id) {
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
  if (community_id === "none") {
    clauses.push(`b.id NOT IN (SELECT being_id FROM being_communities)`);
  } else if (community_id) {
    clauses.push(`b.id IN (
      SELECT being_id FROM being_communities WHERE community_id IN (
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM setting_communities WHERE id = @community_id
          UNION ALL
          SELECT sc.id FROM setting_communities sc JOIN descendants d ON sc.parent_id = d.id
        )
        SELECT id FROM descendants
      )
    )`);
    params.community_id = community_id;
  }
  if (q && q.trim()) {
    // Экранируем % _ \ чтобы пользовательский ввод не стал wildcard
    const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
    const safeQ = escapeLike(q.trim().toLowerCase());
    // "Connected in some way": direct name match, related to a matching
    // being (either direction), a member of a matching community, or
    // sharing a location with a matching being.
    clauses.push(`(
      lower_u(b.name) LIKE @q ESCAPE '\\'
      OR lower_u(COALESCE(b.description,'')) LIKE @q ESCAPE '\\'
      OR lower_u(COALESCE(b.tags,'')) LIKE @q ESCAPE '\\'
      OR lower_u(COALESCE(b.aliases,'')) LIKE @q ESCAPE '\\'
      OR lower_u(COALESCE(b.name_original,'')) LIKE @q ESCAPE '\\'
      OR b.id IN (
        SELECT r.being_b_id FROM being_relations r
        JOIN setting_beings mb ON mb.id = r.being_a_id WHERE lower_u(mb.name) LIKE @q ESCAPE '\\'
        UNION
        SELECT r.being_a_id FROM being_relations r
        JOIN setting_beings mb ON mb.id = r.being_b_id WHERE lower_u(mb.name) LIKE @q ESCAPE '\\'
      )
      OR b.id IN (
        SELECT bc.being_id FROM being_communities bc
        JOIN setting_communities mc ON mc.id = bc.community_id WHERE lower_u(mc.name) LIKE @q ESCAPE '\\'
      )
      OR b.id IN (
        SELECT bl.being_id FROM being_locations bl
        WHERE bl.location_id IN (
          SELECT bl2.location_id FROM being_locations bl2
          JOIN setting_beings mb ON mb.id = bl2.being_id WHERE lower_u(mb.name) LIKE @q ESCAPE '\\'
        )
      )
    )`);
    // lower_u — юникодный lower из db.ts: встроенные LIKE и LOWER в SQLite
    // приводят регистр только у латиницы, и «мирт» не находил «Мирт».
    params.q = `%${safeQ}%`;
  }
  const d = dir === "desc" ? "DESC" : "ASC";
  const orderBy = sort === "recent" ? `b.id ${d}` : sort === "category" ? `b.category COLLATE NOCASE ${d}, b.name COLLATE NOCASE ${d}` : `b.name COLLATE NOCASE ${d}`;
  const rows = db
    .prepare(
      `SELECT b.*, m.name as base_monster_name FROM setting_beings b
       LEFT JOIN compendium_entries m ON m.id = b.base_monster_id
       WHERE ${clauses.join(" AND ")} ORDER BY ${orderBy}`
    )
    .all(params) as { id: number }[];
  const ids = rows.map((r) => r.id);
  const creatureMeta = getCreatureMetaByOwner("being", ids);
  const statblockCounts = getStatblockCountsByOwner("being", ids);
  const communityCounts = getCommunityCountsByOwner(ids);
  const communitiesByBeing = new Map<number, { id: number; name: string }[]>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const commRows = db
      .prepare(
        `SELECT bc.being_id, c.id, c.name FROM being_communities bc
         JOIN setting_communities c ON c.id = bc.community_id
         WHERE bc.being_id IN (${placeholders}) AND c.archived_at IS NULL ORDER BY c.name`
      )
      .all(...ids) as { being_id: number; id: number; name: string }[];
    for (const cr of commRows) {
      const arr = communitiesByBeing.get(cr.being_id) ?? [];
      arr.push({ id: cr.id, name: cr.name });
      communitiesByBeing.set(cr.being_id, arr);
    }
  }
  res.json(
    rows.map((r) => ({
      ...withAvatarUrl(r as { avatar_image_path?: string | null }),
      locations: getLocations(r.id),
      communities: communitiesByBeing.get(r.id) ?? [],
      community_count: communityCounts.get(r.id) ?? 0,
      creature_meta: creatureMeta.get(r.id) ?? null,
      statblock_count: statblockCounts.get(r.id) ?? 0,
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
    statblock_count:
      getStatblockCountsByOwner("being", [Number(req.params.id)]).get(Number(req.params.id)) ?? 0,
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

  const rawExt = (path.extname(req.file.originalname) || ".jpg").toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(rawExt)) return res.status(400).json({ error: "Unsupported image extension" });
  const ext = rawExt;
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

  const rawExt = (path.extname(req.file.originalname) || ".jpg").toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(rawExt)) return res.status(400).json({ error: "Unsupported image extension" });
  const ext = rawExt;
  const target = path.join(being.folder_path, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, being.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE setting_beings SET thumbnail_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withAvatarUrl({ thumbnail_image_path: target }));
});

/**
 * «На основе» существующей записи: статблок и текст приезжают к существу
 * копией — снимком, а не живой ссылкой, чтобы правки существа не трогали
 * компендиум, и наоборот.
 *
 * Только дополняет: ничего не переписывает и не удаляет. Поэтому смена основы
 * у уже заполненного существа безопасна — оно получит второй статблок и новые
 * статьи рядом со своими, а не вместо них. Уже принесённое раньше не
 * дублируется: статблок сверяется по содержимому, статьи — по заголовку и
 * тексту.
 *
 * У записи компендиума своих глав нет — есть описание и, если запись разбита
 * на части, дочерние записи. И то и другое приезжает отдельными статьями.
 */
function inheritFromBaseMonster(beingId: number, baseMonsterId: number) {
  const templates = db
    .prepare(
      `SELECT kind, format, content, note, theme, density FROM statblocks
       WHERE owner_type = 'compendium_entry' AND owner_id = ?`
    )
    .all(baseMonsterId) as {
    kind: string;
    format: string;
    content: string;
    note: string | null;
    theme: string | null;
    density: string | null;
  }[];
  const sameStatblock = db.prepare(
    "SELECT id FROM statblocks WHERE owner_type = 'being' AND owner_id = ? AND content = ?"
  );
  const insertStatblock = db.prepare(
    `INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note, theme, density)
     VALUES ('being', ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of templates) {
    if (sameStatblock.get(beingId, t.content)) continue;
    insertStatblock.run(beingId, t.kind, t.format, t.content, t.note, t.theme, t.density);
  }

  const entry = db
    .prepare(
      `SELECT id, name, description, aliases, name_original, short_name
         FROM compendium_entries WHERE id = ?`
    )
    .get(baseMonsterId) as
    | {
        id: number;
        name: string;
        description: string | null;
        aliases: string | null;
        name_original: string | null;
        short_name: string | null;
      }
    | undefined;
  if (!entry) return;
  const parts = [
    { name: entry.name, description: entry.description },
    ...(db
      .prepare(
        "SELECT name, description FROM compendium_entries WHERE parent_id = ? ORDER BY position, id"
      )
      .all(baseMonsterId) as { name: string; description: string | null }[]),
  ];

  const sameChapter = db.prepare(
    "SELECT id FROM being_chapters WHERE being_id = ? AND title = ? AND content = ?"
  );
  const insertChapter = db.prepare(
    "INSERT INTO being_chapters (being_id, section, title, content) VALUES (?, ?, ?, ?)"
  );
  for (const part of parts) {
    if (!part.description?.trim()) continue;
    if (sameChapter.get(beingId, part.name, part.description)) continue;
    insertChapter.run(beingId, "history", part.name, part.description);
  }

  // Главы шаблона переносятся посекционно: история в историю, поведение в
  // поведение. Раньше переносить было нечего — у записи компендиума глав не
  // было вовсе, и всё описание сваливалось в «Историю» существа.
  const templateChapters = db
    .prepare(
      "SELECT section, title, content FROM compendium_entry_chapters WHERE entry_id = ? ORDER BY created_at, id"
    )
    .all(baseMonsterId) as { section: string; title: string; content: string }[];
  for (const ch of templateChapters) {
    if (!ch.content?.trim() && !ch.title?.trim()) continue;
    if (sameChapter.get(beingId, ch.title, ch.content)) continue;
    insertChapter.run(beingId, ch.section || "history", ch.title, ch.content);
  }

  // Имена подставляются только в пустое: правило «ничего не переписывается»
  // то же, что у статблоков и глав выше.
  const being = db
    .prepare("SELECT aliases, name_original, short_name FROM setting_beings WHERE id = ?")
    .get(beingId) as
    | { aliases: string | null; name_original: string | null; short_name: string | null }
    | undefined;
  if (being) {
    const beingAliases = parseAliases(being.aliases);
    const templateAliases = parseAliases(entry.aliases);
    const mergedAliases = beingAliases.length ? beingAliases : templateAliases;
    db.prepare(
      `UPDATE setting_beings SET
         aliases = ?,
         name_original = CASE WHEN COALESCE(name_original, '') = '' THEN ? ELSE name_original END,
         short_name = CASE WHEN COALESCE(short_name, '') = '' THEN ? ELSE short_name END
       WHERE id = ?`
    ).run(
      JSON.stringify(mergedAliases),
      entry.name_original ?? "",
      entry.short_name ?? null,
      beingId
    );
  }
}

function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

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
  if (!setting_id || !name || !String(name).trim())
    return res.status(400).json({ error: "setting_id and name are required" });
  const trimmedName = String(name).trim();
  if (trimmedName.length > 120) return res.status(400).json({ error: "name too long (max 120)" });
  const allowedCategories = new Set(["key_figure", "influential", "notable", "bestiary"]);
  if (category && !allowedCategories.has(category)) return res.status(400).json({ error: "invalid category" });
  if (Array.isArray(tags) && tags.length > 12) return res.status(400).json({ error: "too many tags (max 12)" });
  const setting = db
    .prepare("SELECT folder_path FROM settings WHERE id = ?")
    .get(setting_id) as { folder_path: string } | undefined;
  if (!setting) return res.status(404).json({ error: "setting not found" });
  const folder = beingFolder(setting.folder_path, trimmedName);

  const sanitizedTags = Array.isArray(tags) ? tags.filter((t) => typeof t === "string").slice(0, 12).map((t) => String(t).slice(0, 24)) : [];
  let insertedId: number | bigint = 0;
  const createTx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO setting_beings
         (setting_id, name, category, location_id, statblock_short, statblock_full, history, behavior, folder_path, tags, base_monster_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        setting_id,
        trimmedName,
        category ?? "bestiary",
        location_id ?? null,
        statblock_short ?? "",
        statblock_full ?? "",
        history ?? "",
        behavior ?? "",
        folder,
        JSON.stringify(sanitizedTags),
        base_monster_id ?? null
      );
    insertedId = info.lastInsertRowid;
    if (location_id) {
      db.prepare(
        "INSERT OR IGNORE INTO being_locations (being_id, location_id) VALUES (?, ?)"
      ).run(insertedId, location_id);
    }
    if (community_ids && community_ids.length > 0) {
      const insertCommunity = db.prepare(
        "INSERT OR IGNORE INTO being_communities (being_id, community_id) VALUES (?, ?)"
      );
      for (const communityId of community_ids) insertCommunity.run(insertedId, communityId);
    }
    if (base_monster_id) {
      inheritFromBaseMonster(Number(insertedId), base_monster_id);
    }
  });
  createTx();
  res
    .status(201)
    .json(
      db
        .prepare(
          `SELECT b.*, m.name as base_monster_name FROM setting_beings b
           LEFT JOIN compendium_entries m ON m.id = b.base_monster_id
           WHERE b.id = ?`
        )
        .get(insertedId)
    );
});

settingBeingsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM setting_beings WHERE id = ?")
    .get(req.params.id) as
    | { folder_path: string; name: string; location_id: number | null; base_monster_id: number | null }
    | undefined;
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
    combat_roles,
    tactics,
    secret,
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
    // Карточка существа: роль в бою (не больше двух), тактика списком строк,
    // секрет. Проза карточки — description выше.
    combat_roles?: string[];
    tactics?: string[];
    secret?: string;
  };
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ error: "name is required" });
    if (trimmed.length > 120) return res.status(400).json({ error: "name too long (max 120)" });
  }
  if (category !== undefined) {
    const allowed = new Set(["key_figure", "influential", "notable", "bestiary"]);
    if (category !== null && !allowed.has(category)) return res.status(400).json({ error: "invalid category" });
  }
  if (Array.isArray(tags) && tags.length > 12) return res.status(400).json({ error: "too many tags (max 12)" });
  if (Array.isArray(combat_roles) && combat_roles.length > 2) return res.status(400).json({ error: "too many combat_roles (max 2)" });
  if (Array.isArray(tactics) && tactics.length > 10) return res.status(400).json({ error: "too many tactics (max 10)" });
  if (typeof short_name === "string" && short_name.length > 40) return res.status(400).json({ error: "short_name too long (max 40)" });
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  const updateTx = db.transaction(() => {
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
       combat_roles = COALESCE(?, combat_roles),
       tactics = COALESCE(?, tactics),
       secret = COALESCE(?, secret),
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
      tags ? JSON.stringify(tags.slice(0, 12).map((t) => String(t).slice(0, 24))) : null,
      base_monster_id !== undefined ? 1 : 0,
      base_monster_id ?? null,
      short_name !== undefined ? 1 : 0,
      short_name ?? null,
      aliases ? JSON.stringify((aliases as string[]).slice(0, 10).map((a) => String(a).slice(0, 80))) : null,
      name_original ?? null,
      combat_roles ? JSON.stringify((combat_roles as string[]).slice(0, 2)) : null,
      tactics ? JSON.stringify((tactics as string[]).slice(0, 10).map((t) => String(t).slice(0, 200))) : null,
      secret ?? null,
      folderPath,
      req.params.id
    );
    if (base_monster_id && base_monster_id !== existing.base_monster_id) {
      inheritFromBaseMonster(Number(req.params.id), base_monster_id);
    }
  });
  updateTx();
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
  if (Array.isArray(community_ids) && community_ids.length > 50) {
    return res.status(400).json({ error: "too many communities (max 50)" });
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM being_communities WHERE being_id = ?").run(req.params.id);
    const insert = db.prepare(
      "INSERT INTO being_communities (being_id, community_id) VALUES (?, ?)"
    );
    for (const communityId of community_ids ?? []) {
      insert.run(req.params.id, communityId);
    }
  });
  tx();
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
