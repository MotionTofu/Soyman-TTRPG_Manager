import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { requireAuth, type AuthedRequest } from "../services/auth";
import {
  standaloneCharacterFolder,
  toFileUrl,
  worldExplorationEntryFolder,
  writeReplacingOldFile,
} from "../services/filesystem";
import { unpaidSessionsForPlayer } from "../services/finance";
import { broadcastCharacterUpdate } from "../services/realtime";

const upload = multer({ storage: multer.memoryStorage() });

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

function myCampaignIds(playerId: number): number[] {
  const rows = db
    .prepare(
      "SELECT DISTINCT campaign_id FROM characters WHERE player_id = ? AND campaign_id IS NOT NULL AND archived_at IS NULL"
    )
    .all(playerId) as { campaign_id: number }[];
  return rows.map((r) => r.campaign_id);
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
    const entries = db
      .prepare(
        `SELECT id, campaign_id, kind, name FROM world_exploration_entries
         WHERE campaign_id IN (${inClause}) AND archived_at IS NULL AND lower_u(name) LIKE ?`
      )
      .all(...campaignIds, like) as { id: number; campaign_id: number; kind: string; name: string }[];
    results.push(
      ...entries.map((e) => ({ type: "world_exploration_entry", id: e.id, title: e.name, subtitle: e.kind }))
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
  const { content, theme, density } = req.body as { content?: string; theme?: string; density?: string };
  db.prepare(
    "UPDATE statblocks SET content = COALESCE(?, content), theme = COALESCE(?, theme), density = COALESCE(?, density) WHERE id = ?"
  ).run(content ?? null, theme ?? null, density ?? null, req.params.id);
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

  const secrets = db
    .prepare(
      `SELECT id, title, content, created_at FROM campaign_entries
       WHERE campaign_id = ? AND category = 'secrets' AND status = 'done'
       ORDER BY created_at DESC`
    )
    .all(campaignId);

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

  const result = [];
  for (const section of allSections) {
    const sectionGranted = grantedSectionIds.has(section.id);
    if (section.kind === "gallery") {
      if (!sectionGranted) continue;
      const images = db
        .prepare("SELECT * FROM gallery_images WHERE owner_type = 'campaign_player_section' AND owner_id = ? ORDER BY position, id")
        .all(section.id) as { image_path: string }[];
      result.push({ ...section, images: images.map((img) => ({ ...img, image_url: toFileUrl(img.image_path) })) });
    } else {
      let articles;
      if (sectionGranted) {
        articles = db
          .prepare("SELECT * FROM campaign_player_articles WHERE section_id = ? ORDER BY position, id")
          .all(section.id);
      } else {
        const own = db
          .prepare("SELECT * FROM campaign_player_articles WHERE section_id = ? ORDER BY position, id")
          .all(section.id) as { id: number }[];
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
    .prepare(`SELECT * FROM setting_locations WHERE setting_id = ? AND id IN (${inClause(locationIds)})`)
    .all(campaign.setting_id, ...locationIds);

  const beingIds = idsFor("setting_being");
  const beings = db
    .prepare(`SELECT * FROM setting_beings WHERE setting_id = ? AND id IN (${inClause(beingIds)})`)
    .all(campaign.setting_id, ...beingIds);

  const communityIds = idsFor("setting_community");
  const communities = db
    .prepare(`SELECT * FROM setting_communities WHERE setting_id = ? AND id IN (${inClause(communityIds)})`)
    .all(campaign.setting_id, ...communityIds);

  const eventIds = idsFor("setting_calendar_event");
  const chronicleEvents = db
    .prepare(`SELECT * FROM setting_calendar_events WHERE setting_id = ? AND id IN (${inClause(eventIds)})`)
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
      `SELECT DISTINCT s.id, s.name FROM settings s
       JOIN campaigns c ON c.setting_id = s.id
       WHERE c.id IN (${campaignIds.map(() => "?").join(",")})
       ORDER BY s.name COLLATE NOCASE`
    )
    .all(...campaignIds);
  res.json(rows);
});

playerRouter.get("/settings/:id", (req: AuthedRequest, res) => {
  const settingId = Number(req.params.id);
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

  const locationIds = new Set<number>();
  const beingIds = new Set<number>();
  const communityIds = new Set<number>();
  const eventIds = new Set<number>();
  for (const { id: campaignId } of myCampaignsWithSetting) {
    const grants = db
      .prepare(
        "SELECT target_type, target_id FROM player_visibility_grants WHERE campaign_id = ? AND player_id = ?"
      )
      .all(campaignId, playerId) as { target_type: string; target_id: number }[];
    for (const g of grants) {
      if (g.target_type === "setting_location") locationIds.add(g.target_id);
      else if (g.target_type === "setting_being") beingIds.add(g.target_id);
      else if (g.target_type === "setting_community") communityIds.add(g.target_id);
      else if (g.target_type === "setting_calendar_event") eventIds.add(g.target_id);
    }
  }
  const inClause = (ids: Set<number>) => (ids.size ? [...ids].map(() => "?").join(",") : "-1");

  const locations = db
    .prepare(`SELECT * FROM setting_locations WHERE setting_id = ? AND id IN (${inClause(locationIds)})`)
    .all(settingId, ...locationIds);
  const beings = db
    .prepare(`SELECT * FROM setting_beings WHERE setting_id = ? AND id IN (${inClause(beingIds)})`)
    .all(settingId, ...beingIds);
  const communities = db
    .prepare(`SELECT * FROM setting_communities WHERE setting_id = ? AND id IN (${inClause(communityIds)})`)
    .all(settingId, ...communityIds);
  const chronicleEvents = db
    .prepare(`SELECT * FROM setting_calendar_events WHERE setting_id = ? AND id IN (${inClause(eventIds)})`)
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

function withEntryAvatarUrl<T extends { avatar_image_path?: string | null }>(row: T) {
  return { ...row, avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null };
}

// "Исследование мира" — shared party journal, not private per player: any
// party member (anyone in myCampaignIds for this campaign) can read/create/
// edit/delete any entry, same as sitting around one shared notebook.
playerRouter.get("/campaigns/:id/world-entries", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  if (!myCampaignIds(req.user!.playerId!).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  const { kind } = req.query as { kind?: string };
  const clauses = ["e.campaign_id = ?", "e.archived_at IS NULL"];
  const params: (string | number)[] = [campaignId];
  if (kind) {
    clauses.push("e.kind = ?");
    params.push(kind);
  }
  const rows = db
    .prepare(
      `SELECT e.*, p.name as player_name FROM world_exploration_entries e
       LEFT JOIN players p ON p.id = e.player_id
       WHERE ${clauses.join(" AND ")} ORDER BY e.name COLLATE NOCASE`
    )
    .all(...params);
  res.json(rows.map((r) => withEntryAvatarUrl(r as { avatar_image_path: string | null })));
});

playerRouter.post("/campaigns/:id/world-entries", (req: AuthedRequest, res) => {
  const campaignId = Number(req.params.id);
  const playerId = req.user!.playerId!;
  if (!myCampaignIds(playerId).includes(campaignId)) {
    return res.status(404).json({ error: "not found" });
  }
  const { kind, name, description, extra_field } = req.body as {
    kind?: string;
    name?: string;
    description?: string;
    extra_field?: string;
  };
  if (!kind) return res.status(400).json({ error: "kind is required" });
  const campaign = db.prepare("SELECT folder_path FROM campaigns WHERE id = ?").get(campaignId) as
    | { folder_path: string }
    | undefined;
  if (!campaign) return res.status(404).json({ error: "not found" });
  const folder = worldExplorationEntryFolder(campaign.folder_path, kind, name || "Без имени");
  const info = db
    .prepare(
      `INSERT INTO world_exploration_entries (campaign_id, player_id, kind, name, description, extra_field, folder_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(campaignId, playerId, kind, name ?? "", description ?? "", extra_field ?? "", folder);
  res
    .status(201)
    .json(
      withEntryAvatarUrl(
        db.prepare("SELECT * FROM world_exploration_entries WHERE id = ?").get(info.lastInsertRowid) as {
          avatar_image_path: string | null;
        }
      )
    );
});

// Throws-as-404 guard mirroring requireOwnCharacter, but scoped to "my
// campaign" rather than "my own record" — the journal is shared party-wide.
function requireEntryInMyCampaign(playerId: number, entryId: string | number) {
  const entry = db.prepare("SELECT * FROM world_exploration_entries WHERE id = ?").get(entryId) as
    | { id: number; campaign_id: number; folder_path: string; avatar_image_path: string | null }
    | undefined;
  if (!entry || !myCampaignIds(playerId).includes(entry.campaign_id)) return null;
  return entry;
}

playerRouter.put("/world-entries/:id", (req: AuthedRequest, res) => {
  const entry = requireEntryInMyCampaign(req.user!.playerId!, req.params.id);
  if (!entry) return res.status(404).json({ error: "not found" });
  const { name, description, extra_field } = req.body as {
    name?: string;
    description?: string;
    extra_field?: string;
  };
  db.prepare(
    `UPDATE world_exploration_entries SET
       name = COALESCE(?, name), description = COALESCE(?, description), extra_field = COALESCE(?, extra_field)
     WHERE id = ?`
  ).run(name ?? null, description ?? null, extra_field ?? null, entry.id);
  res.json(
    withEntryAvatarUrl(
      db.prepare("SELECT * FROM world_exploration_entries WHERE id = ?").get(entry.id) as {
        avatar_image_path: string | null;
      }
    )
  );
});

playerRouter.delete("/world-entries/:id", (req: AuthedRequest, res) => {
  const entry = requireEntryInMyCampaign(req.user!.playerId!, req.params.id);
  if (!entry) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE world_exploration_entries SET archived_at = datetime('now') WHERE id = ?").run(entry.id);
  res.json({ ok: true });
});

playerRouter.post("/world-entries/:id/avatar", upload.single("file"), async (req: AuthedRequest, res) => {
  const entry = requireEntryInMyCampaign(req.user!.playerId!, req.params.id);
  if (!entry) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(entry.folder_path, `avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, entry.avatar_image_path, "avatar");

  db.prepare("UPDATE world_exploration_entries SET avatar_image_path = ? WHERE id = ?").run(target, entry.id);
  res.json(withEntryAvatarUrl({ avatar_image_path: target }));
});
