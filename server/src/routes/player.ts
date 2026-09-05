import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { requireAuth, type AuthedRequest } from "../services/auth";
import {
  standaloneCharacterFolder,
  toFileUrl,
  writeReplacingOldFile,
} from "../services/filesystem";
import { unpaidSessionsForPlayer } from "../services/finance";
import { broadcastCharacterUpdate } from "../services/realtime";
import { mergeContentPatch } from "../db/statblockContent";

const ALLOWED_IMAGE_MIMES = /^image\/(jpeg|png|gif|webp|avif)$/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// Everything here is scoped to the authenticated player account's own
// player_id — never trusts an id from the request body/query for anything
// that determines *whose* data gets read or written. Used by the player
// desktop sandbox app and the player mobile app; the GM desktop app never
// calls these (AUTH_ENABLED is off there, so requireAuth("player") below is
// a no-op and req.user is always undefined — see services/auth.ts).
export const playerRouter = Router();
playerRouter.use(requireAuth("player"));

interface CharacterRow {
  id: number;
  player_id: number;
  campaign_id: number | null;
  character_name: string;
  avatar_image_path: string | null;
  created_at: string;
}

// Членство в кампании — по ростеру, а не по живым персонажам (2026-09-02).
// Ростером Мастер управляет сам (кнопка «выбыл» в профиле кампании), по нему
// же считаются посещаемость и список игроков. Прежняя проверка «есть активный
// персонаж» склеивала два разных события: игрок, чей персонаж погиб, вместе с
// ним терял всю кампанию — включая дневник этого персонажа, — а игрок,
// добавленный Мастером до создания персонажа, не видел ничего.
function myCampaignIds(playerId: number): number[] {
  const rows = db
    .prepare("SELECT campaign_id FROM campaign_roster WHERE player_id = ?")
    .all(playerId) as { campaign_id: number }[];
  return rows.map((r) => r.campaign_id);
}

// Выбывший (`status = 'left'`) читает всё, включая то, что Мастер откроет
// после его ухода, но ничего не пишет. Совсем закрыть кампанию Мастер может,
// убрав игрока из ростера — это соседняя кнопка.
function canWriteInCampaign(playerId: number, campaignId: number): boolean {
  const row = db
    .prepare("SELECT status FROM campaign_roster WHERE player_id = ? AND campaign_id = ?")
    .get(playerId, campaignId) as { status: string } | undefined;
  return row?.status === "active";
}

// Throws-as-404 guard used by every route below that takes a :characterId —
// keeps "not mine" and "doesn't exist" indistinguishable to the caller.
function requireOwnCharacter(playerId: number, characterId: string | number): CharacterRow | null {
  const row = db
    .prepare("SELECT * FROM characters WHERE id = ? AND player_id = ? AND archived_at IS NULL")
    .get(characterId, playerId) as CharacterRow | undefined;
  return row ?? null;
}

playerRouter.get("/me", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId;
  if (!playerId) return res.status(400).json({ error: "this account isn't linked to a player" });
  const player = db.prepare("SELECT id, name FROM players WHERE id = ?").get(playerId);
  const characters = db
    .prepare(
      `SELECT c.id, c.character_name, c.campaign_id, c.avatar_image_path, camp.name as campaign_name
       FROM characters c LEFT JOIN campaigns camp ON camp.id = c.campaign_id
       WHERE c.player_id = ? AND c.archived_at IS NULL
       ORDER BY c.created_at`
    )
    .all(playerId);
  res.json({ user: req.user, player, characters });
});

// Главная: 3 nearest upcoming sessions across every campaign the player is
// in, held-but-underpaid sessions, and active GM reminders (per-player or
// broadcast to one of their campaigns).
playerRouter.get("/dashboard", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const campaignIds = myCampaignIds(playerId);

  const upcomingSessions = campaignIds.length
    ? db
        .prepare(
          `SELECT s.id, s.campaign_id, c.name as campaign_name, s.date, s.title, s.start_time
           FROM sessions s JOIN campaigns c ON c.id = s.campaign_id
           WHERE s.campaign_id IN (${campaignIds.map(() => "?").join(",")})
             AND s.status = 'planned' AND s.archived_at IS NULL AND s.date >= date('now')
           ORDER BY s.date ASC, s.start_time ASC
           LIMIT 3`
        )
        .all(...campaignIds)
    : [];

  const unpaidSessions = unpaidSessionsForPlayer(playerId);

  const reminderParams: (string | number)[] = [playerId];
  const campaignClause = campaignIds.length
    ? ` OR (target_type = 'campaign' AND target_id IN (${campaignIds.map(() => "?").join(",")}))`
    : "";
  if (campaignIds.length) reminderParams.push(...campaignIds);
  const reminders = db
    .prepare(
      `SELECT * FROM gm_reminders
       WHERE (target_type = 'player' AND target_id = ?)${campaignClause}
       ORDER BY created_at DESC`
    )
    .all(...reminderParams);

  // Unfiltered (all statuses, no date/LIMIT bound) — feeds the calendar grid
  // on Главная, unlike upcomingSessions above which is the trimmed "next 3" list.
  const sessions = campaignIds.length
    ? db
        .prepare(
          `SELECT s.id, s.campaign_id, c.name as campaign_name, s.date, s.title, s.start_time, s.status
           FROM sessions s JOIN campaigns c ON c.id = s.campaign_id
           WHERE s.campaign_id IN (${campaignIds.map(() => "?").join(",")})
             AND s.archived_at IS NULL
           ORDER BY s.date ASC, s.start_time ASC`
        )
        .all(...campaignIds)
    : [];

  res.json({ upcomingSessions, unpaidSessions, reminders, sessions });
});

// Systems used by any of the player's campaigns — not every system in the
// vault, only ones they actually have access to via a campaign membership.
playerRouter.get("/systems", (req: AuthedRequest, res) => {
  const campaignIds = myCampaignIds(req.user!.playerId!);
  if (!campaignIds.length) return res.json([]);
  const rows = db
    .prepare(
      `SELECT DISTINCT sys.id, sys.name
       FROM systems sys JOIN campaigns c ON c.system_id = sys.id
       WHERE c.id IN (${campaignIds.map(() => "?").join(",")}) AND sys.archived_at IS NULL
       ORDER BY sys.name`
    )
    .all(...campaignIds);
  res.json(rows);
});

// Standalone character — not tied to any campaign, filed under the player's
// own vault folder. system_id is optional (a character can exist with no
// mechanical system attached yet).
playerRouter.post("/characters", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const { character_name, system_id } = req.body as { character_name?: string; system_id?: number | null };
  if (!character_name) return res.status(400).json({ error: "character_name is required" });
  const player = db.prepare("SELECT folder_path FROM players WHERE id = ?").get(playerId) as
    | { folder_path: string }
    | undefined;
  if (!player) return res.status(404).json({ error: "not found" });
  const folder = standaloneCharacterFolder(player.folder_path, character_name);
  const info = db
    .prepare(
      "INSERT INTO characters (player_id, campaign_id, system_id, character_name, folder_path) VALUES (?, NULL, ?, ?, ?)"
    )
    .run(playerId, system_id ?? null, character_name, folder);
  res.status(201).json(db.prepare("SELECT * FROM characters WHERE id = ?").get(info.lastInsertRowid));
});

// Scoped search: own characters, world-exploration entries in own campaigns,
// and compendium entries in systems used by own campaigns. Deliberately not
// a thin wrapper on the GM-only /api/search — that route has no visibility
// scoping at all.
playerRouter.get("/search", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  // lower_u — юникодный lower из db.ts: встроенный LIKE в SQLite приводит
  // регистр только у латиницы, и «мирт» не находил бы «Мирт».
  const like = `%${q.toLowerCase()}%`;
  const campaignIds = myCampaignIds(playerId);
  const results: { type: string; id: number; title: string; subtitle?: string }[] = [];

  const characters = db
    .prepare("SELECT id, character_name FROM characters WHERE player_id = ? AND archived_at IS NULL AND lower_u(character_name) LIKE ?")
    .all(playerId, like) as { id: number; character_name: string }[];
  results.push(...characters.map((c) => ({ type: "character", id: c.id, title: c.character_name })));

  if (campaignIds.length) {
    const inClause = campaignIds.map(() => "?").join(",");
    // Дневник личный: в поиске находятся только собственные заметки, и ищется
    // не только заголовок (он необязателен), но и сам текст.
    const entries = db
      .prepare(
        `SELECT id, campaign_id, kind, name, description FROM world_exploration_entries
         WHERE campaign_id IN (${inClause}) AND player_id = ? AND archived_at IS NULL
           AND (lower_u(name) LIKE ? OR lower_u(description) LIKE ?)`
      )
      .all(...campaignIds, playerId, like, like) as {
      id: number;
      campaign_id: number;
      kind: string;
      name: string;
      description: string;
    }[];
    results.push(
      ...entries.map((e) => ({
        type: "world_exploration_entry",
        id: e.id,
        title: e.name || e.description.slice(0, 60) || "Заметка",
        subtitle: e.kind,
      }))
    );

    const systemIds = db
      .prepare(`SELECT DISTINCT system_id FROM campaigns WHERE id IN (${inClause}) AND system_id IS NOT NULL`)
      .all(...campaignIds) as { system_id: number }[];
    if (systemIds.length) {
      const sysClause = systemIds.map(() => "?").join(",");
      const compendiumEntries = db
        .prepare(
          `SELECT id, system_id, section_id, kind, name FROM compendium_entries
           WHERE system_id IN (${sysClause}) AND lower_u(name) LIKE ?`
        )
        .all(...systemIds.map((s) => s.system_id), like) as {
        id: number;
        system_id: number;
        section_id: number;
        kind: string;
        name: string;
      }[];
      results.push(
        ...compendiumEntries.map((e) => ({
          type: "compendium_entry",
          id: e.id,
          title: e.name,
          subtitle: e.kind,
          system_id: e.system_id,
          section_id: e.section_id,
        }))
      );
    }
  }

  res.json(results.slice(0, 50));
});

playerRouter.get("/characters/:id", (req: AuthedRequest, res) => {
  const character = requireOwnCharacter(req.user!.playerId!, req.params.id);
  if (!character) return res.status(404).json({ error: "not found" });
  const campaignName = character.campaign_id
    ? (db.prepare("SELECT name FROM campaigns WHERE id = ?").get(character.campaign_id) as { name: string } | undefined)
        ?.name ?? null
    : null;
  const chapters = db
    .prepare("SELECT * FROM character_chapters WHERE character_id = ? ORDER BY created_at")
    .all(character.id);
  const statblocks = db
    .prepare("SELECT * FROM statblocks WHERE owner_type = 'character' AND owner_id = ? ORDER BY created_at")
    .all(character.id);
  res.json({ ...character, campaign_name: campaignName, chapters, statblocks });
});

// Входящие персонажа — то, что лежит на обороте его карты (гриллинг
// 2026-09-04). Три источника в одном списке: личные послания этому
// персонажу, послания игроку и объявления всей кампании. Кампанийные видны
// с любой карты игрока, личные — только со своей.
playerRouter.get("/characters/:id/inbox", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const character = requireOwnCharacter(playerId, req.params.id);
  if (!character) return res.status(404).json({ error: "not found" });
  const campaignIds = myCampaignIds(playerId);
  // Кампания у персонажа одна, и объявления берём только из неё: чужие
  // кампании того же игрока к этой карте отношения не имеют.
  const campaignId = campaignIds.includes(character.campaign_id as number) ? character.campaign_id : null;
  const params: (string | number)[] = [character.id, playerId];
  let clause = "(target_type = 'character' AND target_id = ?) OR (target_type = 'player' AND target_id = ?)";
  if (campaignId != null) {
    clause += " OR (target_type = 'campaign' AND target_id = ?)";
    params.push(campaignId as number);
  }
  res.json(
    db
      .prepare(`SELECT * FROM gm_reminders WHERE ${clause} ORDER BY read_at IS NOT NULL, created_at DESC`)
      .all(...params)
  );
});

// Прочтение ставит адресат, а не Мастер. Кампанийное объявление помечает
// прочитанным первый же его прочитавший — оно общее, и заводить ради него
// таблицу «кто прочитал» значит строить половину мессенджера ради строки,
// которую и так видят все.
playerRouter.post("/reminders/:id/read", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const row = db.prepare("SELECT * FROM gm_reminders WHERE id = ?").get(req.params.id) as
    | { id: number; target_type: string; target_id: number }
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const mine =
    (row.target_type === "player" && row.target_id === playerId) ||
    (row.target_type === "campaign" && myCampaignIds(playerId).includes(row.target_id)) ||
    (row.target_type === "character" && !!requireOwnCharacter(playerId, String(row.target_id)));
  if (!mine) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE gm_reminders SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL").run(row.id);
  res.json(db.prepare("SELECT * FROM gm_reminders WHERE id = ?").get(row.id));
});

// Own out-of-character notes — a free-form chapter section distinct from the
// GM-authored backstory/arc ones (see character_chapters.section).
playerRouter.post("/characters/:id/notes", (req: AuthedRequest, res) => {
  const character = requireOwnCharacter(req.user!.playerId!, req.params.id);
  if (!character) return res.status(404).json({ error: "not found" });
  const { content } = req.body as { content?: string };
  const info = db
    .prepare("INSERT INTO character_chapters (character_id, section, title, content) VALUES (?, 'player_notes', '', ?)")
    .run(character.id, content ?? "");
  broadcastCharacterUpdate(character.id);
  res.status(201).json(db.prepare("SELECT * FROM character_chapters WHERE id = ?").get(info.lastInsertRowid));
});

playerRouter.put("/characters/:id/chapters/:chapterId", (req: AuthedRequest, res) => {
  const character = requireOwnCharacter(req.user!.playerId!, req.params.id);
  if (!character) return res.status(404).json({ error: "not found" });
  const chapter = db
    .prepare("SELECT id FROM character_chapters WHERE id = ? AND character_id = ?")
    .get(req.params.chapterId, character.id);
  if (!chapter) return res.status(404).json({ error: "not found" });
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare("UPDATE character_chapters SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?").run(
    title ?? null,
    content ?? null,
    req.params.chapterId
  );
  broadcastCharacterUpdate(character.id);
  res.json(db.prepare("SELECT * FROM character_chapters WHERE id = ?").get(req.params.chapterId));
});

// "Залить чарник нового уровня" — the player edits their own statblock's
// content, same table/shape the GM app already reads (StatblockList).
playerRouter.put("/statblocks/:id", (req: AuthedRequest, res) => {
  const statblock = db.prepare("SELECT * FROM statblocks WHERE id = ?").get(req.params.id) as
    | { id: number; owner_type: string; owner_id: number }
    | undefined;
  if (!statblock || statblock.owner_type !== "character") return res.status(404).json({ error: "not found" });
  if (!requireOwnCharacter(req.user!.playerId!, statblock.owner_id)) {
    return res.status(404).json({ error: "not found" });
  }
  const { content, theme, density, contentPatch } = req.body as {
    content?: string;
    theme?: string;
    density?: string;
    contentPatch?: Record<string, unknown>;
  };
  // Тот же патч изменённых полей, что и у мастерского маршрута: именно здесь
  // столкновение и живёт — игрок правит хиты со своего телефона, пока Мастер
  // держит тот же лист открытым, и снимок целиком стирал бы чужую правку.
  if (
    contentPatch !== undefined &&
    (contentPatch === null || typeof contentPatch !== "object" || Array.isArray(contentPatch))
  ) {
    return res.status(400).json({ error: "contentPatch должен быть объектом" });
  }
  const stored = db.prepare("SELECT content FROM statblocks WHERE id = ?").get(req.params.id) as
    | { content: string }
    | undefined;
  const nextContent =
    contentPatch !== undefined
      ? mergeContentPatch(stored?.content ?? "", contentPatch)
      : (content ?? null);
  db.prepare(
    "UPDATE statblocks SET content = COALESCE(?, content), theme = COALESCE(?, theme), density = COALESCE(?, density), updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?"
  ).run(nextContent, theme ?? null, density ?? null, req.params.id);
  broadcastCharacterUpdate(statblock.owner_id);
  res.json(db.prepare("SELECT * FROM statblocks WHERE id = ?").get(req.params.id));
});

// Everything the GM has explicitly marked visible for one of the player's
// own campaigns — session recaps, setting lore articles, world chronicle,
// revealed secrets. Filtered server-side (not just hidden in the UI) so a
// bug in a client can't leak anything the GM hasn't opted to reveal.
playerRouter.get("/campaigns/:id/visible", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  if (!myCampaignIds(req.user!.playerId!).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  const campaign = db.prepare("SELECT id, name, setting_id, system_id FROM campaigns WHERE id = ?").get(campaignId) as
    | { id: number; name: string; setting_id: number | null; system_id: number | null }
    | undefined;
  if (!campaign) return res.status(404).json({ error: "not found" });

  const sessions = db
    .prepare(
      `SELECT id, date, title, main_events FROM sessions
       WHERE campaign_id = ? AND main_events_visible = 1 AND archived_at IS NULL
       ORDER BY date DESC`
    )
    .all(campaignId);

  // Just date/time/status — not gated behind main_events_visible like the
  // recap content above. A player in the campaign always gets to know when
  // sessions are happening, independent of whether the GM has written up
  // (and revealed) a summary of what happened in them.
  const schedule = db
    .prepare(
      `SELECT id, date, start_time, title, status FROM sessions
       WHERE campaign_id = ? AND archived_at IS NULL
       ORDER BY date DESC`
    )
    .all(campaignId);

  // Раскрытые тайны: и собственные записи кампании, и тайны привязанных к
  // ней приключений — с тех пор как то и другое живёт одной моделью.
  const secrets = db
    .prepare(
      `SELECT s.id, s.title, s.content, s.kind FROM story_secrets s
       JOIN campaign_secret_state st ON st.secret_id = s.id AND st.campaign_id = @campaign
       WHERE st.revealed = 1
         AND (s.campaign_id = @campaign
              OR s.arc_id IN (SELECT arc_id FROM campaign_adventures WHERE campaign_id = @campaign))
       ORDER BY st.updated_at DESC`
    )
    .all({ campaign: campaignId });

  let locationArticles: unknown[] = [];
  let beingArticles: unknown[] = [];
  let chronicleEvents: unknown[] = [];
  if (campaign.setting_id) {
    locationArticles = db
      .prepare(
        `SELECT lc.id, lc.title, lc.content, lc.created_at, sl.name as location_name
         FROM location_chapters lc JOIN setting_locations sl ON sl.id = lc.location_id
         WHERE sl.setting_id = ? AND lc.visible_to_players = 1
         ORDER BY lc.created_at DESC`
      )
      .all(campaign.setting_id);
    beingArticles = db
      .prepare(
        `SELECT bc.id, bc.title, bc.content, bc.created_at, sb.name as being_name
         FROM being_chapters bc JOIN setting_beings sb ON sb.id = bc.being_id
         WHERE sb.setting_id = ? AND bc.visible_to_players = 1
         ORDER BY bc.created_at DESC`
      )
      .all(campaign.setting_id);
    chronicleEvents = db
      .prepare(
        `SELECT id, title, description, inworld_year, inworld_month, inworld_day
         FROM setting_calendar_events
         WHERE setting_id = ? AND visible_to_players = 1
         ORDER BY inworld_year DESC, inworld_month DESC, inworld_day DESC`
      )
      .all(campaign.setting_id);
  }

  res.json({ campaign, sessions, schedule, secrets, locationArticles, beingArticles, chronicleEvents });
});

// The rest of the party — other players' characters in this campaign, name
// only (no statblocks/notes/finances — just enough for "who else is at the
// table"). Excludes the caller's own character(s).
playerRouter.get("/campaigns/:id/party", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  const playerId = req.user!.playerId!;
  if (!myCampaignIds(playerId).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  const party = db
    .prepare(
      `SELECT c.id, c.character_name, p.name as player_name, c.avatar_image_path
       FROM characters c JOIN players p ON p.id = c.player_id
       WHERE c.campaign_id = ? AND c.player_id != ? AND c.archived_at IS NULL
       ORDER BY c.character_name COLLATE NOCASE`
    )
    .all(campaignId, playerId) as { id: number; character_name: string; player_name: string; avatar_image_path: string | null }[];
  res.json(party.map((m) => ({ ...m, avatar_image_url: m.avatar_image_path ? toFileUrl(m.avatar_image_path) : null })));
});

// GM-authored custom "Для игроков" sections/articles for one of the player's
// own campaigns, filtered to what's actually been granted to this player
// (see player_visibility_grants). A section is included if either the whole
// section is granted, or (for articles-kind sections) at least one of its
// articles is individually granted — in that case only the granted articles
// are returned, not the whole section.
playerRouter.get("/campaigns/:id/player-sections", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  const playerId = req.user!.playerId!;
  if (!myCampaignIds(playerId).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  const grants = db
    .prepare(
      "SELECT target_type, target_id FROM player_visibility_grants WHERE campaign_id = ? AND player_id = ?"
    )
    .all(campaignId, playerId) as { target_type: string; target_id: number }[];
  const grantedSectionIds = new Set(
    grants.filter((g) => g.target_type === "campaign_player_section").map((g) => g.target_id)
  );
  const grantedArticleIds = new Set(
    grants.filter((g) => g.target_type === "campaign_player_article").map((g) => g.target_id)
  );

  const allSections = db
    .prepare("SELECT * FROM campaign_player_sections WHERE campaign_id = ? ORDER BY position, id")
    .all(campaignId) as { id: number; kind: string; name: string }[];

  // Batch load to avoid N+1 per-section queries (C-P2-4 / Phase 1.2)
  const gallerySectionIds = allSections.filter((s) => s.kind === "gallery" && grantedSectionIds.has(s.id)).map((s) => s.id);
  const galleryImagesBySection = new Map<number, { image_path: string; image_url: string }[]>();
  if (gallerySectionIds.length) {
    const inClause = gallerySectionIds.map(() => "?").join(",");
    const galleryRows = db
      .prepare(
        `SELECT * FROM gallery_images WHERE owner_type = 'campaign_player_section' AND owner_id IN (${inClause}) ORDER BY position, id`
      )
      .all(...gallerySectionIds) as ({ owner_id: number; image_path: string } & Record<string, unknown>)[];
    for (const r of galleryRows) {
      const arr = galleryImagesBySection.get(r.owner_id) ?? [];
      arr.push({ ...(r as object), image_url: toFileUrl(r.image_path) } as { image_path: string; image_url: string });
      galleryImagesBySection.set(r.owner_id, arr);
    }
  }

  const articleSectionIds = allSections.filter((s) => s.kind !== "gallery").map((s) => s.id);
  const articlesBySection = new Map<number, { id: number }[]>();
  if (articleSectionIds.length) {
    const inClause = articleSectionIds.map(() => "?").join(",");
    const articleRows = db
      .prepare(`SELECT * FROM campaign_player_articles WHERE section_id IN (${inClause}) ORDER BY position, id`)
      .all(...articleSectionIds) as { id: number; section_id: number }[];
    for (const r of articleRows) {
      const arr = articlesBySection.get(r.section_id) ?? [];
      arr.push(r as { id: number });
      articlesBySection.set(r.section_id, arr);
    }
  }

  const result = [];
  for (const section of allSections) {
    const sectionGranted = grantedSectionIds.has(section.id);
    if (section.kind === "gallery") {
      if (!sectionGranted) continue;
      const images = galleryImagesBySection.get(section.id) ?? [];
      result.push({ ...section, images });
    } else {
      const own = (articlesBySection.get(section.id) ?? []) as { id: number }[];
      let articles: { id: number }[];
      if (sectionGranted) {
        articles = own;
      } else {
        articles = own.filter((a) => grantedArticleIds.has(a.id));
        if (articles.length === 0) continue;
      }
      result.push({ ...section, articles });
    }
  }
  res.json(result);
});

// Setting content reused into the campaign's "Для игроков" tab (fixed
// subsections Локации/Личности и Фракции/Бестиарий/История — see
// SettingDetailPage's own tabs for the GM-side equivalents). Same grant
// table, just scoped to setting_* target types instead of campaign_player_*.
playerRouter.get("/campaigns/:id/setting-player-content", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isFinite(campaignId)) return res.status(400).json({ error: "invalid campaign id" });
  const playerId = req.user!.playerId!;
  if (!myCampaignIds(playerId).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  const campaign = db.prepare("SELECT setting_id FROM campaigns WHERE id = ?").get(campaignId) as
    | { setting_id: number | null }
    | undefined;
  if (!campaign || !campaign.setting_id) {
    return res.json({ locations: [], beings: [], communities: [], chronicleEvents: [] });
  }
  const grants = db
    .prepare(
      "SELECT target_type, target_id FROM player_visibility_grants WHERE campaign_id = ? AND player_id = ?"
    )
    .all(campaignId, playerId) as { target_type: string; target_id: number }[];
  const idsFor = (type: string) => grants.filter((g) => g.target_type === type).map((g) => g.target_id);
  const inClause = (ids: number[]) => (ids.length ? ids.map(() => "?").join(",") : "-1");

  const locationIds = idsFor("setting_location");
  const locations = db
    .prepare(`SELECT id, name, description FROM setting_locations WHERE setting_id = ? AND id IN (${inClause(locationIds)})`)
    .all(campaign.setting_id, ...locationIds);

  const beingIds = idsFor("setting_being");
  const beings = db
    .prepare(`SELECT id, name, history FROM setting_beings WHERE setting_id = ? AND id IN (${inClause(beingIds)})`)
    .all(campaign.setting_id, ...beingIds);

  const communityIds = idsFor("setting_community");
  const communities = db
    .prepare(`SELECT id, name, description FROM setting_communities WHERE setting_id = ? AND id IN (${inClause(communityIds)})`)
    .all(campaign.setting_id, ...communityIds);

  const eventIds = idsFor("setting_calendar_event");
  const chronicleEvents = db
    .prepare(`SELECT id, title, description, inworld_year, inworld_month, inworld_day FROM setting_calendar_events WHERE setting_id = ? AND id IN (${inClause(eventIds)})`)
    .all(campaign.setting_id, ...eventIds);

  res.json({ locations, beings, communities, chronicleEvents });
});

// Settings used by any of the player's campaigns — a setting can be shared
// across several campaigns (and grants are per campaign+player, see above),
// so this lists distinct settings and the detail route below unions what's
// been revealed to this player across every campaign of theirs using it.
playerRouter.get("/settings", (req: AuthedRequest, res) => {
  const campaignIds = myCampaignIds(req.user!.playerId!);
  if (!campaignIds.length) return res.json([]);
  const rows = db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.description,
              s.thumbnail_image_path, s.background_image_path
       FROM settings s
       JOIN campaigns c ON c.setting_id = s.id
       WHERE c.id IN (${campaignIds.map(() => "?").join(",")})
       ORDER BY s.name COLLATE NOCASE`
    )
    .all(...campaignIds) as { id: number; name: string; description: string | null; thumbnail_image_path: string | null; background_image_path: string | null }[];
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    thumbnail_image_url: r.thumbnail_image_path ? toFileUrl(r.thumbnail_image_path) : null,
    background_image_url: r.background_image_path ? toFileUrl(r.background_image_path) : null,
  })));
});

playerRouter.get("/settings/:id", (req: AuthedRequest, res) => {
  const settingId = Number(req.params.id);
  if (!Number.isFinite(settingId)) return res.status(400).json({ error: "invalid setting id" });
  const playerId = req.user!.playerId!;
  const campaignIds = myCampaignIds(playerId);
  const myCampaignsWithSetting = campaignIds.length
    ? (db
        .prepare(
          `SELECT id FROM campaigns WHERE setting_id = ? AND id IN (${campaignIds.map(() => "?").join(",")})`
        )
        .all(settingId, ...campaignIds) as { id: number }[])
    : [];
  if (!myCampaignsWithSetting.length) return res.status(404).json({ error: "not found" });

  const setting = db.prepare("SELECT id, name FROM settings WHERE id = ?").get(settingId) as
    | { id: number; name: string }
    | undefined;
  if (!setting) return res.status(404).json({ error: "not found" });

  const campaignIdList = myCampaignsWithSetting.map((c) => c.id);
  const inClause = (ids: number[]) => (ids.length ? ids.map(() => "?").join(",") : "-1");

  // Single batch query instead of N per-campaign queries
  const grantRows = campaignIdList.length
    ? (db
        .prepare(
          `SELECT DISTINCT target_type, target_id FROM player_visibility_grants WHERE campaign_id IN (${inClause(campaignIdList)}) AND player_id = ?`
        )
        .all(...campaignIdList, playerId) as { target_type: string; target_id: number }[])
    : [];

  const locationIds: number[] = [];
  const beingIds: number[] = [];
  const communityIds: number[] = [];
  const eventIds: number[] = [];
  for (const g of grantRows) {
    if (g.target_type === "setting_location") locationIds.push(g.target_id);
    else if (g.target_type === "setting_being") beingIds.push(g.target_id);
    else if (g.target_type === "setting_community") communityIds.push(g.target_id);
    else if (g.target_type === "setting_calendar_event") eventIds.push(g.target_id);
  }

  // Minimal fields — players don't need statblocks, behavior, tags, etc.
  const locations = db
    .prepare(`SELECT id, name, description FROM setting_locations WHERE setting_id = ? AND id IN (${inClause(locationIds)})`)
    .all(settingId, ...locationIds);
  const beings = db
    .prepare(`SELECT id, name, history FROM setting_beings WHERE setting_id = ? AND id IN (${inClause(beingIds)})`)
    .all(settingId, ...beingIds);
  const communities = db
    .prepare(`SELECT id, name, description FROM setting_communities WHERE setting_id = ? AND id IN (${inClause(communityIds)})`)
    .all(settingId, ...communityIds);
  const chronicleEvents = db
    .prepare(`SELECT id, title, description, inworld_year, inworld_month, inworld_day FROM setting_calendar_events WHERE setting_id = ? AND id IN (${inClause(eventIds)})`)
    .all(settingId, ...eventIds);

  res.json({ setting, locations, beings, communities, chronicleEvents });
});

// Read-only rules reference — not secret content, so no per-campaign
// filtering beyond "this system belongs to one of my campaigns".
playerRouter.get("/compendium/:systemId", (req: AuthedRequest, res) => {
  const systemId = Number(req.params.systemId);
  const campaignIds = myCampaignIds(req.user!.playerId!);
  const hasAccess =
    campaignIds.length > 0 &&
    db
      .prepare(`SELECT 1 FROM campaigns WHERE id IN (${campaignIds.map(() => "?").join(",")}) AND system_id = ?`)
      .get(...campaignIds, systemId);
  if (!hasAccess) return res.status(404).json({ error: "not found" });
  const sections = db.prepare("SELECT * FROM system_sections WHERE system_id = ? ORDER BY position").all(systemId);
  const entries = db.prepare("SELECT * FROM compendium_entries WHERE system_id = ? ORDER BY position").all(systemId);
  res.json({ sections, entries });
});

// Карточка существа для записи бестиария — ею открываются жетоны спутников
// на карте персонажа (CreatureCardLoader). Мастерский /creature-card игроку
// закрыт, а отдавать его как есть нельзя: в payload лежит `secret`.
// Поэтому секрет здесь вырезан на сервере, а не только спрятан клиентом
// (playerSafe прячет его и в рендере — оборона в глубину). Скоуп: система
// записи стоит хотя бы в одной кампании игрока. Существа сеттинга (being)
// игроку не отдаём вовсе — это не его инструмент.
playerRouter.get("/creature-card/compendium_entry/:id", (req: AuthedRequest, res) => {
  const entry = db
    .prepare(
      `SELECT ce.id, ce.name, ce.description, ce.combat_roles, ce.tactics, ce.avatar_image_path,
              ce.system_id
       FROM compendium_entries ce WHERE ce.id = ?`
    )
    .get(req.params.id) as
    | {
        id: number;
        name: string;
        description: string | null;
        combat_roles: string;
        tactics: string;
        avatar_image_path: string | null;
        system_id: number;
      }
    | undefined;
  if (!entry) return res.status(404).json({ error: "not found" });
  const campaignIds = myCampaignIds(req.user!.playerId!);
  const hasAccess =
    campaignIds.length > 0 &&
    db
      .prepare(`SELECT 1 FROM campaigns WHERE id IN (${campaignIds.map(() => "?").join(",")}) AND system_id = ?`)
      .get(...campaignIds, entry.system_id);
  if (!hasAccess) return res.status(404).json({ error: "not found" });
  const parseList = (raw: unknown): string[] => {
    if (typeof raw !== "string" || !raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  const statblock = db
    .prepare(
      `SELECT id, kind, format, content, theme, density, avatar_image_path
       FROM statblocks WHERE owner_type = 'compendium_entry' AND owner_id = ? AND format = 'dnd_creature'
       ORDER BY CASE kind WHEN 'full' THEN 0 ELSE 1 END, id`
    )
    .get(entry.id) as
    | {
        id: number;
        kind: string;
        format: string;
        content: string;
        theme: string | null;
        density: string | null;
        avatar_image_path: string | null;
      }
    | undefined;
  const { avatar_image_path: sbAvatar, ...sbRest } = statblock ?? {};
  res.json({
    type: "compendium_entry",
    id: entry.id,
    name: entry.name,
    description: entry.description ?? "",
    combat_roles: parseList(entry.combat_roles),
    tactics: parseList(entry.tactics),
    secret: "",
    avatar_image_url: entry.avatar_image_path ? toFileUrl(entry.avatar_image_path) : null,
    statblock: statblock
      ? { ...sbRest, avatar_image_url: sbAvatar ? toFileUrl(sbAvatar) : null }
      : null,
    statblock_inherited: false,
    inherited: null,
  });
});
// «Исследование мира» — личный дневник персонажа (2026-09-02, разбор в
// SideWorks/Профиль_Кампании_Игрок.md). Раньше это был общий блокнот партии:
// любой участник кампании читал, правил и архивировал чужие записи. Теперь
// запись принадлежит персонажу, видит её только автор, а Мастер не видит
// вовсе — прежний мастерский роут /api/world-exploration-entries удалён.
//
// character_id = NULL — законное состояние: игрок пишет до того, как завёл
// персонажа, или у него их несколько и он ещё не сказал, чей это дневник.
// Такие записи показываются автору отдельной группой с предложением выбрать.
const WORLD_ENTRY_COLUMNS =
  "id, campaign_id, player_id, character_id, kind, name, description, created_at";

// Метка типа теперь необязательна: пустая строка — «без метки». Белый список
// нужен, чтобы в базу не попадали значения, которых нет ни на одной вкладке —
// такую запись потом не найти и не удалить из интерфейса.
const WORLD_ENTRY_KINDS = new Set(["", "being", "location", "item", "event"]);

// Длины совпадают с maxLength полей формы. Клиентская проверка — удобство, а
// не защита: запрос приходит и мимо формы.
function clampField(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Персонаж, на которого можно писать: мой, в этой кампании и не в архиве.
// Дневник погибшего (архивного) персонажа читается, но не пополняется — иначе
// его знание тихо продолжало бы расти после его смерти.
function writableCharacter(playerId: number, campaignId: number, characterId: unknown): number | null {
  if (characterId == null) return null;
  const row = db
    .prepare(
      "SELECT id FROM characters WHERE id = ? AND player_id = ? AND campaign_id = ? AND archived_at IS NULL"
    )
    .get(characterId, playerId, campaignId) as { id: number } | undefined;
  return row?.id ?? null;
}

// Персонажи игрока в этой кампании — для переключателя дневников. Архивные
// приходят тоже: их дневник открывается на чтение, поэтому в списке они есть,
// помеченные `archived`.
playerRouter.get("/campaigns/:id/my-characters", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  const playerId = req.user!.playerId!;
  if (!myCampaignIds(playerId).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  const rows = db
    .prepare(
      `SELECT id, character_name, avatar_image_path, archived_at
       FROM characters WHERE player_id = ? AND campaign_id = ?
       ORDER BY archived_at IS NOT NULL, character_name COLLATE NOCASE`
    )
    .all(playerId, campaignId) as {
    id: number;
    character_name: string;
    avatar_image_path: string | null;
    archived_at: string | null;
  }[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      character_name: r.character_name,
      archived: r.archived_at != null,
      avatar_image_url: r.avatar_image_path ? toFileUrl(r.avatar_image_path) : null,
    }))
  );
});

playerRouter.get("/campaigns/:id/world-entries", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  const playerId = req.user!.playerId!;
  if (!myCampaignIds(playerId).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  // Свежее сверху: дневник читают, чтобы вспомнить последнее, а не чтобы
  // листать алфавит. Порядок задаётся здесь, а не на клиенте, чтобы поиск и
  // лента не разъезжались.
  const rows = db
    .prepare(
      `SELECT ${WORLD_ENTRY_COLUMNS} FROM world_exploration_entries
       WHERE campaign_id = ? AND player_id = ? AND archived_at IS NULL
       ORDER BY created_at DESC, id DESC`
    )
    .all(campaignId, playerId);
  res.json(rows);
});

playerRouter.post("/campaigns/:id/world-entries", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  const playerId = req.user!.playerId!;
  if (!myCampaignIds(playerId).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  if (!canWriteInCampaign(playerId, campaignId)) {
    return res.status(403).json({ error: "read only in this campaign" });
  }
  const { kind, name, description, character_id } = req.body as {
    kind?: string;
    name?: string;
    description?: string;
    character_id?: number | null;
  };
  const cleanKind = typeof kind === "string" ? kind : "";
  if (!WORLD_ENTRY_KINDS.has(cleanKind)) return res.status(400).json({ error: "unknown kind" });
  const cleanName = clampField(name, 80);
  const cleanDescription = clampField(description, 5000);
  if (!cleanName && !cleanDescription) return res.status(400).json({ error: "empty entry" });
  const info = db
    .prepare(
      `INSERT INTO world_exploration_entries (campaign_id, player_id, character_id, kind, name, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      campaignId,
      playerId,
      writableCharacter(playerId, campaignId, character_id),
      cleanKind,
      cleanName,
      cleanDescription
    );
  res
    .status(201)
    .json(
      db
        .prepare(`SELECT ${WORLD_ENTRY_COLUMNS} FROM world_exploration_entries WHERE id = ?`)
        .get(info.lastInsertRowid)
    );
});

// Гвард дневника: своя запись, и кампания, в которой ещё можно писать.
// «Своя» здесь — по автору: даже соседу по партии чужая заметка невидима, а
// значит и неправима.
function requireMyWritableEntry(playerId: number, entryId: string | number) {
  const entry = db
    .prepare("SELECT * FROM world_exploration_entries WHERE id = ? AND player_id = ?")
    .get(entryId, playerId) as { id: number; campaign_id: number; character_id: number | null } | undefined;
  if (!entry || !canWriteInCampaign(playerId, entry.campaign_id)) return null;
  return entry;
}

playerRouter.put("/world-entries/:id", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const entry = requireMyWritableEntry(playerId, req.params.id);
  if (!entry) return res.status(404).json({ error: "not found" });
  const { name, description, kind, character_id } = req.body as {
    name?: string;
    description?: string;
    kind?: string;
    character_id?: number | null;
  };
  if (kind !== undefined && !WORLD_ENTRY_KINDS.has(kind)) {
    return res.status(400).json({ error: "unknown kind" });
  }
  db.prepare(
    `UPDATE world_exploration_entries SET
       name = COALESCE(?, name), description = COALESCE(?, description),
       kind = COALESCE(?, kind), character_id = COALESCE(?, character_id)
     WHERE id = ?`
  ).run(
    name === undefined ? null : clampField(name, 80),
    description === undefined ? null : clampField(description, 5000),
    kind === undefined ? null : kind,
    // Привязать заметку к персонажу можно, отвязать обратно в «ничьё» — нет:
    // это не действие, которого кто-то хочет, а способ потерять запись из виду.
    character_id === undefined ? null : writableCharacter(playerId, entry.campaign_id, character_id),
    entry.id
  );
  res.json(
    db.prepare(`SELECT ${WORLD_ENTRY_COLUMNS} FROM world_exploration_entries WHERE id = ?`).get(entry.id)
  );
});

playerRouter.delete("/world-entries/:id", (req: AuthedRequest, res) => {
  const entry = requireMyWritableEntry(req.user!.playerId!, req.params.id);
  if (!entry) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE world_exploration_entries SET archived_at = datetime('now') WHERE id = ?").run(entry.id);
  res.json({ ok: true });
});

// Возврат только что удалённой записи — под кнопкой «Отменить» в тосте
// (client/src/hooks/useUndoDelete.tsx). Отдельного экрана архива у игрока нет:
// либо вернул сразу, либо запись ушла.
playerRouter.post("/world-entries/:id/restore", (req: AuthedRequest, res) => {
  const entry = requireMyWritableEntry(req.user!.playerId!, req.params.id);
  if (!entry) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE world_exploration_entries SET archived_at = NULL WHERE id = ?").run(entry.id);
  res.json({ ok: true });
});

// --- Передачи вещей между персонажами игроков (этап 4б) ---
//
// Игрок не пишет в чужой лист напрямую (PUT /player/statblocks/:id отдаёт
// 404 на чужой статблок), поэтому посредник — сервер: оффер, проверки
// наличия в момент принятия («потратил до принятия» — оффер гаснет,
// отправитель ничего не замечает) и locked-строки в оба листа.
// Уведомления об отказе и чек о деньгах едут строкой gm_reminders персонажу:
// для них уже есть оборот, отдельного мессенджера не заводим.

interface TransferRow {
  id: number;
  sender_character_id: number;
  sender_name: string;
  recipient_character_id: number;
  recipient_name: string;
  kind: string;
  item_name: string;
  item_json: string;
  qty: number;
  coins_json: string;
  state: string;
}

interface SheetHandle {
  sheetId: number;
  data: Record<string, unknown>;
}

interface EquipmentSection {
  name: string;
  items: Record<string, unknown>[];
}

// Лист dnd_character персонажа: его нет, например, пока игрок не залил
// чарник нового уровня — передавать тогда некуда и неоткуда.
function transferSheet(characterId: number): SheetHandle | null {
  const sheet = db
    .prepare("SELECT id, content FROM statblocks WHERE owner_type = 'character' AND owner_id = ? AND format = 'dnd_character' ORDER BY id LIMIT 1")
    .get(characterId) as { id: number; content: string } | undefined;
  if (!sheet) return null;
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(sheet.content || "{}");
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return null;
  }
  return { sheetId: sheet.id, data };
}

function writeTransferSheet(handle: SheetHandle, characterId: number): void {
  db.prepare("UPDATE statblocks SET content = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?").run(
    JSON.stringify(handle.data),
    handle.sheetId
  );
  broadcastCharacterUpdate(characterId);
}

function transferSections(data: Record<string, unknown>): EquipmentSection[] {
  const raw = data.equipmentSections;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is EquipmentSection => !!s && typeof s === "object" && Array.isArray((s as EquipmentSection).items));
}

// Строка вещи по адресу из оффера. Сверяем и имя: стак могли переименовать
// или потратить после предложения — тогда оффер честно гаснет, а не едет
// не туда.
function transferItem(
  sections: EquipmentSection[],
  section: number,
  index: number,
  name: string
): { sec: EquipmentSection; item: Record<string, unknown> } | null {
  const sec = sections[section];
  const item = sec?.items[index];
  if (!sec || !item || typeof item.name !== "string" || item.name !== name) return null;
  return { sec, item };
}

// qty вещи — строка; пустая и нечисловая означают одну штуку.
function transferHave(item: Record<string, unknown>): number {
  const n = parseInt(String(item.qty ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const COIN_KEYS = ["cp", "sp", "ep", "gp", "pp"] as const;
type Coins = Record<(typeof COIN_KEYS)[number], number>;

function transferCoins(data: Record<string, unknown>): Record<string, string> {
  const raw = (data.coins ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of COIN_KEYS) out[k] = typeof raw[k] === "string" ? raw[k] : "";
  return out;
}

function coinNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return null;
  return n;
}

function formatCoins(coins: Coins): string {
  const names: Record<string, string> = { cp: "мм", sp: "см", ep: "эм", gp: "зм", pp: "пм" };
  return COIN_KEYS.filter((k) => coins[k] > 0)
    .map((k) => `${coins[k]} ${names[k]}`)
    .join(", ");
}

function getTransfer(id: string | number): TransferRow | null {
  return (db.prepare("SELECT * FROM character_transfers WHERE id = ?").get(id) ?? null) as TransferRow | null;
}

function setTransferState(id: number, state: string): void {
  db.prepare("UPDATE character_transfers SET state = ?, updated_at = datetime('now') WHERE id = ?").run(state, id);
}

// Получатель оффера: мой персонаж той же кампании, живой, с залитым чарником.
// Отправителя дарит только свой активный персонаж (canWriteInCampaign):
// дневник погибшего читается, но знание мертвеца уже не раздаривает вещи.
function transferPeer(playerId: number, senderId: number, recipientId: number): { ok: boolean; error?: string } {
  const sender = requireOwnCharacter(playerId, senderId);
  if (!sender) return { ok: false, error: "not found" };
  if (!canWriteInCampaign(playerId, sender.campaign_id as number)) {
    return { ok: false, error: "read only in this campaign" };
  }
  const recipient = db
    .prepare("SELECT id, character_name, campaign_id FROM characters WHERE id = ? AND archived_at IS NULL")
    .get(recipientId) as { id: number; character_name: string; campaign_id: number } | undefined;
  if (!recipient || recipient.id === senderId) return { ok: false, error: "not found" };
  if (recipient.campaign_id !== sender.campaign_id) return { ok: false, error: "not found" };
  if (!transferSheet(recipient.id)) return { ok: false, error: "у получателя нет чарника D&D" };
  return { ok: true };
}

// Активные передачи персонажа: входящие офферы/принятые и исходящие.
// История (declined/returned/claimed/expired) не отдаётся: её заменяют
// состояния строк в листах и уведомления-строки в обороте.
playerRouter.get("/characters/:id/transfers", (req: AuthedRequest, res) => {
  const character = requireOwnCharacter(req.user!.playerId!, req.params.id);
  if (!character) return res.status(404).json({ error: "not found" });
  const rows = db
    .prepare("SELECT * FROM character_transfers WHERE (sender_character_id = ? OR recipient_character_id = ?) AND state IN ('offered','accepted') ORDER BY created_at DESC, id DESC")
    .all(character.id, character.id) as TransferRow[];
  res.json({
    incoming: rows.filter((r) => r.recipient_character_id === character.id),
    outgoing: rows.filter((r) => r.sender_character_id === character.id),
  });
});

// Предложение: вещь (kind=item|replica) или деньги (kind=money — уходят
// сразу, чеком получателю). Вещь до принятия остаётся у отправителя обычной.
playerRouter.post("/characters/:id/transfers", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const senderId = Number(req.params.id);
  const { recipient_character_id, section, index, qty, kind, coins } = req.body as {
    recipient_character_id?: number;
    section?: number;
    index?: number;
    qty?: number;
    kind?: string;
    coins?: Partial<Record<string, unknown>>;
  };
  const recipientId = Number(recipient_character_id);
  if (!Number.isFinite(recipientId)) return res.status(400).json({ error: "recipient_character_id is required" });
  const peer = transferPeer(playerId, senderId, recipientId);
  if (!peer.ok) return res.status(peer.error === "read only in this campaign" ? 403 : 404).json({ error: peer.error });
  const sender = requireOwnCharacter(playerId, senderId)!;
  const recipient = db.prepare("SELECT id, character_name FROM characters WHERE id = ?").get(recipientId) as {
    id: number;
    character_name: string;
  };

  if (kind === "money") {
    const amounts = {} as Coins;
    for (const k of COIN_KEYS) {
      const n = coinNumber(coins?.[k] ?? 0);
      if (n === null) return res.status(400).json({ error: `bad coins.${k}` });
      amounts[k] = n;
    }
    if (!COIN_KEYS.some((k) => amounts[k] > 0)) return res.status(400).json({ error: "empty transfer" });
    const senderSheet = transferSheet(senderId)!;
    const recipientSheet = transferSheet(recipientId)!;
    const senderCoins = transferCoins(senderSheet.data);
    for (const k of COIN_KEYS) {
      const have = parseInt(senderCoins[k] || "0", 10) || 0;
      if (have < amounts[k]) return res.status(409).json({ error: `не хватает: ${k}` });
    }
    const recipientCoins = transferCoins(recipientSheet.data);
    for (const k of COIN_KEYS) {
      senderCoins[k] = String((parseInt(senderCoins[k] || "0", 10) || 0) - amounts[k]);
      recipientCoins[k] = String((parseInt(recipientCoins[k] || "0", 10) || 0) + amounts[k]);
    }
    senderSheet.data.coins = senderCoins;
    recipientSheet.data.coins = recipientCoins;
    writeTransferSheet(senderSheet, senderId);
    writeTransferSheet(recipientSheet, recipientId);
    const info = db
      .prepare(
        `INSERT INTO character_transfers (sender_character_id, sender_name, recipient_character_id, recipient_name, kind, coins_json, qty, state)
         VALUES (?, ?, ?, ?, 'money', ?, 0, 'claimed')`
      )
      .run(senderId, sender.character_name, recipientId, recipient.character_name, JSON.stringify(amounts));
    db.prepare("INSERT INTO gm_reminders (target_type, target_id, message) VALUES ('character', ?, ?)").run(
      recipientId,
      `«${sender.character_name}» передал: ${formatCoins(amounts)}`
    );
    return res.status(201).json(db.prepare("SELECT * FROM character_transfers WHERE id = ?").get(info.lastInsertRowid));
  }

  if (kind !== undefined && kind !== "item" && kind !== "replica") {
    return res.status(400).json({ error: "unknown kind" });
  }
  const senderSheet = transferSheet(senderId);
  if (!senderSheet) return res.status(404).json({ error: "у отправителя нет чарника D&D" });
  const sections = transferSections(senderSheet.data);
  const found = transferItem(sections, Number(section), Number(index), String((req.body as { name?: unknown }).name ?? ""));
  if (!found) return res.status(404).json({ error: "предмет не найден" });
  if (found.item.transferOut || found.item.transferIn) {
    return res.status(409).json({ error: "предмет уже в передаче" });
  }
  const want = qty === undefined ? transferHave(found.item) : Number(qty);
  if (!Number.isFinite(want) || Math.floor(want) !== want || want < 1 || want > transferHave(found.item)) {
    return res.status(400).json({ error: "bad qty" });
  }
  const { transferOut: _dropOut, transferIn: _dropIn, equipped: _dropEq, qty: _dropQty, ...snapshot } = found.item;
  const info = db
    .prepare(
      `INSERT INTO character_transfers (sender_character_id, sender_name, recipient_character_id, recipient_name, kind, item_name, item_json, qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      senderId,
      sender.character_name,
      recipientId,
      recipient.character_name,
      kind ?? "item",
      String(found.item.name),
      JSON.stringify(snapshot),
      want
    );
  res.status(201).json(db.prepare("SELECT * FROM character_transfers WHERE id = ?").get(info.lastInsertRowid));
});

// Принятие: вещь делится (остаток свободен, доля — locked-строкой),
// получателю ложится зелёная (принято) или фиолетовая (создано) строка.
// Гонка «потратил до принятия»: вещи или хваталки нет — оффер гаснет
// в expired, отправитель ничего не замечает (решение владельца).
playerRouter.post("/transfers/:id/accept", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const row = getTransfer(req.params.id);
  if (!row || row.state !== "offered") return res.status(404).json({ error: "not found" });
  if (!requireOwnCharacter(playerId, row.recipient_character_id)) return res.status(404).json({ error: "not found" });
  const senderSheet = transferSheet(row.sender_character_id);
  const recipientSheet = transferSheet(row.recipient_character_id);
  if (!senderSheet || !recipientSheet) {
    setTransferState(row.id, "expired");
    return res.status(409).json({ error: "чарки недоступны" });
  }
  const sections = transferSections(senderSheet.data);
  const snapshot = JSON.parse(row.item_json || "{}") as Record<string, unknown>;
  // Адрес устарел, а имя живо (строку двигали по секциям): ищем по имени.
  let found: { sec: EquipmentSection; item: Record<string, unknown> } | null = null;
  for (const sec of sections) {
    const idx = sec.items.findIndex(
      (it) => typeof it?.name === "string" && it.name === row.item_name && !it.transferOut && !it.transferIn
    );
    if (idx >= 0) {
      found = { sec, item: sec.items[idx] };
      break;
    }
  }
  if (!found || transferHave(found.item) < row.qty) {
    setTransferState(row.id, "expired");
    return res.status(409).json({ error: "предмет уже недоступен" });
  }
  const have = transferHave(found.item);
  const lock = {
    id: row.id,
    toCharacterId: row.recipient_character_id,
    toName: row.recipient_name,
    qty: row.qty,
  };
  if (have === row.qty) {
    found.item.qty = String(row.qty);
    found.item.equipped = false;
    found.item.transferOut = lock;
  } else {
    found.item.qty = String(have - row.qty);
    found.sec.items.splice(sections.indexOf(found.sec) >= 0 ? found.sec.items.indexOf(found.item) + 1 : 0, 0, {
      ...snapshot,
      name: row.item_name,
      qty: String(row.qty),
      equipped: false,
      transferOut: lock,
    });
  }
  const recipientSections = transferSections(recipientSheet.data);
  const first = recipientSections[0];
  if (!first) {
    setTransferState(row.id, "expired");
    return res.status(409).json({ error: "у получателя нет секций снаряжения" });
  }
  first.items.push({
    ...snapshot,
    name: row.item_name,
    qty: String(row.qty),
    equipped: false,
    transferIn: {
      id: row.id,
      fromCharacterId: row.sender_character_id,
      fromName: row.sender_name,
      kind: row.kind,
    },
  });
  writeTransferSheet(senderSheet, row.sender_character_id);
  writeTransferSheet(recipientSheet, row.recipient_character_id);
  setTransferState(row.id, "accepted");
  res.json(db.prepare("SELECT * FROM character_transfers WHERE id = ?").get(row.id));
});

// Отказ: отправителю уходит строка «отклонено» в оборот его карты.
playerRouter.post("/transfers/:id/decline", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const row = getTransfer(req.params.id);
  if (!row || row.state !== "offered") return res.status(404).json({ error: "not found" });
  if (!requireOwnCharacter(playerId, row.recipient_character_id)) return res.status(404).json({ error: "not found" });
  setTransferState(row.id, "declined");
  const what = row.kind === "money" ? formatCoins(JSON.parse(row.coins_json || "{}") as Coins) : `${row.item_name} ×${row.qty}`;
  db.prepare("INSERT INTO gm_reminders (target_type, target_id, message) VALUES ('character', ?, ?)").run(
    row.sender_character_id,
    `«${row.recipient_name}» отклонил передачу: ${what}`
  );
  res.json(db.prepare("SELECT * FROM character_transfers WHERE id = ?").get(row.id));
});

// Возврат принятого: зелёная строка исчезает у получателя, серая
// разблокируется у отправителя. Частично потраченную долю не высчитываем:
// v1 считает долю целой, иначе — expired с разблокировкой отправителя.
playerRouter.post("/transfers/:id/return", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const row = getTransfer(req.params.id);
  if (!row || row.state !== "accepted") return res.status(404).json({ error: "not found" });
  if (!requireOwnCharacter(playerId, row.recipient_character_id)) return res.status(404).json({ error: "not found" });
  const recipientSheet = transferSheet(row.recipient_character_id);
  const senderSheet = transferSheet(row.sender_character_id);
  if (recipientSheet) {
    for (const sec of transferSections(recipientSheet.data)) {
      const idx = sec.items.findIndex((it) => (it.transferIn as { id?: number } | undefined)?.id === row.id);
      if (idx >= 0) sec.items.splice(idx, 1);
    }
    writeTransferSheet(recipientSheet, row.recipient_character_id);
  }
  if (senderSheet) {
    for (const sec of transferSections(senderSheet.data)) {
      const item = sec.items.find((it) => (it.transferOut as { id?: number } | undefined)?.id === row.id);
      if (item) delete item.transferOut;
    }
    writeTransferSheet(senderSheet, row.sender_character_id);
  }
  setTransferState(row.id, "returned");
  res.json(db.prepare("SELECT * FROM character_transfers WHERE id = ?").get(row.id));
});

// Сделать своим: серая строка исчезает у отправителя, зелёная становится
// обычной вещью получателя — ни цвета, ни чипа.
playerRouter.post("/transfers/:id/claim", (req: AuthedRequest, res) => {
  const playerId = req.user!.playerId!;
  const row = getTransfer(req.params.id);
  if (!row || row.state !== "accepted") return res.status(404).json({ error: "not found" });
  if (!requireOwnCharacter(playerId, row.recipient_character_id)) return res.status(404).json({ error: "not found" });
  const recipientSheet = transferSheet(row.recipient_character_id);
  const senderSheet = transferSheet(row.sender_character_id);
  if (recipientSheet) {
    for (const sec of transferSections(recipientSheet.data)) {
      const item = sec.items.find((it) => (it.transferIn as { id?: number } | undefined)?.id === row.id);
      if (item) delete item.transferIn;
    }
    writeTransferSheet(recipientSheet, row.recipient_character_id);
  }
  if (senderSheet) {
    for (const sec of transferSections(senderSheet.data)) {
      const idx = sec.items.findIndex((it) => (it.transferOut as { id?: number } | undefined)?.id === row.id);
      if (idx >= 0) sec.items.splice(idx, 1);
    }
    writeTransferSheet(senderSheet, row.sender_character_id);
  }
  setTransferState(row.id, "claimed");
  res.json(db.prepare("SELECT * FROM character_transfers WHERE id = ?").get(row.id));
});
