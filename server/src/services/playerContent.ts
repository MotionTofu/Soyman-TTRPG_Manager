// Расчёт выдачи игроку (Кабинет игрока, 2026-09-12, шаг 3).
//
// Один расчёт на два входа: /player/* (сам игрок) и превью «Глазами игрока»
// (мастер, GET /visibility-grants/preview). Предпросмотр, считающий
// видимость своим способом, врал бы ровно тогда, когда нужен, — при раздаче
// доступов. Поэтому оба входа зовут функции ниже, а не дублируют запросы.
//
// Урезание — здесь, на сервере: при ступени 'mentioned' описания и прочие
// полные поля не уходят с сервера вовсе, прятать их на клиенте нельзя
// (player.ts — граница безопасности).

import { db } from "../db/db";
import { toFileUrl } from "./filesystem";
import { normalizeAccessLevel, type AccessLevel } from "./accessLevel";

export type AccessGrantRow = { target_type: string; target_id: number; access_level: string | null };

function splitGrantIds(grants: AccessGrantRow[], type: string): { mentioned: number[]; open: number[] } {
  const mentioned: number[] = [];
  const open: number[] = [];
  for (const g of grants) {
    if (g.target_type !== type) continue;
    if (normalizeAccessLevel(g.access_level) === "mentioned") mentioned.push(g.target_id);
    else open.push(g.target_id);
  }
  return { mentioned, open };
}

// Сводка ступеней по нескольким кампаниям (GET /player/settings/:id
// объединяет выданное во всех кампаниях игрока на одном сеттинге): 'open'
// хотя бы в одной побеждает 'mentioned' — иначе честно открытое в одном
// месте пряталось бы из-за упоминания в другом.
function unionGrantLevels(grants: AccessGrantRow[]): Map<string, AccessLevel> {
  const out = new Map<string, AccessLevel>();
  for (const g of grants) {
    const level = normalizeAccessLevel(g.access_level);
    const key = `${g.target_type}:${g.target_id}`;
    if (level === "open" || !out.has(key)) out.set(key, level);
  }
  return out;
}

function idsAtLevel(levels: Map<string, AccessLevel>, type: string, want: AccessLevel): number[] {
  const out: number[] = [];
  for (const [key, level] of levels) {
    if (level !== want) continue;
    const [t, id] = key.split(":");
    if (t === type) out.push(Number(id));
  }
  return out;
}

function withImageUrls<T extends { avatar_image_path?: string | null; thumbnail_image_path?: string | null }>(row: T) {
  return {
    ...row,
    avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
  };
}

const inClause = (ids: number[]) => (ids.length ? ids.map(() => "?").join(",") : "-1");

export interface SettingPlayerContentPayload {
  locations: Record<string, unknown>[];
  beings: Record<string, unknown>[];
  communities: Record<string, unknown>[];
  chronicleEvents: Record<string, unknown>[];
}

const EMPTY_SETTING_CONTENT: SettingPlayerContentPayload = {
  locations: [],
  beings: [],
  communities: [],
  chronicleEvents: [],
};

// Мир кампании для игрока: выдача из сеттинга по грантам (campaign_id,
// player_id). Пусто, если у кампании нет сеттинга.
export function getSettingPlayerContent(campaignId: number, playerId: number): SettingPlayerContentPayload {
  const campaign = db.prepare("SELECT setting_id FROM campaigns WHERE id = ?").get(campaignId) as
    | { setting_id: number | null }
    | undefined;
  if (!campaign || !campaign.setting_id) return { ...EMPTY_SETTING_CONTENT };
  const grants = db
    .prepare(
      "SELECT target_type, target_id, access_level FROM player_visibility_grants WHERE campaign_id = ? AND player_id = ?"
    )
    .all(campaignId, playerId) as AccessGrantRow[];
  const settingId = campaign.setting_id;

  const loc = splitGrantIds(grants, "setting_location");
  const locations = [
    ...(db
      .prepare(`SELECT id, parent_id, name, kind, description, player_text, avatar_image_path, thumbnail_image_path FROM setting_locations WHERE setting_id = ? AND id IN (${inClause(loc.open)})`)
      .all(settingId, ...loc.open) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "open" as const })),
    ...(db
      .prepare(`SELECT id, parent_id, name, kind, avatar_image_path, thumbnail_image_path FROM setting_locations WHERE setting_id = ? AND id IN (${inClause(loc.mentioned)})`)
      .all(settingId, ...loc.mentioned) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "mentioned" as const })),
  ];

  const bei = splitGrantIds(grants, "setting_being");
  const beings = [
    ...(db
      .prepare(`SELECT id, name, category, history, player_text, avatar_image_path, thumbnail_image_path FROM setting_beings WHERE setting_id = ? AND id IN (${inClause(bei.open)})`)
      .all(settingId, ...bei.open) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "open" as const })),
    ...(db
      .prepare(`SELECT id, name, category, avatar_image_path, thumbnail_image_path FROM setting_beings WHERE setting_id = ? AND id IN (${inClause(bei.mentioned)})`)
      .all(settingId, ...bei.mentioned) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "mentioned" as const })),
  ];

  const com = splitGrantIds(grants, "setting_community");
  const communities = [
    ...(db
      .prepare(`SELECT id, name, description, player_text, avatar_image_path, thumbnail_image_path FROM setting_communities WHERE setting_id = ? AND id IN (${inClause(com.open)})`)
      .all(settingId, ...com.open) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "open" as const })),
    ...(db
      .prepare(`SELECT id, name, avatar_image_path, thumbnail_image_path FROM setting_communities WHERE setting_id = ? AND id IN (${inClause(com.mentioned)})`)
      .all(settingId, ...com.mentioned) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "mentioned" as const })),
  ];

  const ev = splitGrantIds(grants, "setting_calendar_event");
  const chronicleEvents = [
    ...(db
      .prepare(`SELECT id, title, description, player_text, inworld_year, inworld_month, inworld_day FROM setting_calendar_events WHERE setting_id = ? AND id IN (${inClause(ev.open)})`)
      .all(settingId, ...ev.open) as Record<string, unknown>[]).map((r) => ({ ...r, access_level: "open" as const })),
    ...(db
      .prepare(`SELECT id, title, inworld_year, inworld_month, inworld_day FROM setting_calendar_events WHERE setting_id = ? AND id IN (${inClause(ev.mentioned)})`)
      .all(settingId, ...ev.mentioned) as Record<string, unknown>[]).map((r) => ({ ...r, access_level: "mentioned" as const })),
  ];

  return { locations, beings, communities, chronicleEvents };
}

// Тот же Мир, но сведённый по всем кампаниям игрока на одном сеттинге
// (GET /player/settings/:id). 'open' хотя бы в одной побеждает.
export function getSettingPlayerContentUnion(settingId: number, campaignIds: number[], playerId: number): SettingPlayerContentPayload {
  const grantRows = campaignIds.length
    ? (db
        .prepare(
          `SELECT target_type, target_id, access_level FROM player_visibility_grants WHERE campaign_id IN (${inClause(campaignIds)}) AND player_id = ?`
        )
        .all(...campaignIds, playerId) as AccessGrantRow[])
    : [];
  const levels = unionGrantLevels(grantRows);

  const locOpen = idsAtLevel(levels, "setting_location", "open");
  const locMentioned = idsAtLevel(levels, "setting_location", "mentioned");
  const beiOpen = idsAtLevel(levels, "setting_being", "open");
  const beiMentioned = idsAtLevel(levels, "setting_being", "mentioned");
  const comOpen = idsAtLevel(levels, "setting_community", "open");
  const comMentioned = idsAtLevel(levels, "setting_community", "mentioned");
  const evOpen = idsAtLevel(levels, "setting_calendar_event", "open");
  const evMentioned = idsAtLevel(levels, "setting_calendar_event", "mentioned");

  const locations = [
    ...(db
      .prepare(`SELECT id, parent_id, name, kind, description, player_text, avatar_image_path, thumbnail_image_path FROM setting_locations WHERE setting_id = ? AND id IN (${inClause(locOpen)})`)
      .all(settingId, ...locOpen) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "open" as const })),
    ...(db
      .prepare(`SELECT id, parent_id, name, kind, avatar_image_path, thumbnail_image_path FROM setting_locations WHERE setting_id = ? AND id IN (${inClause(locMentioned)})`)
      .all(settingId, ...locMentioned) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "mentioned" as const })),
  ];
  const beings = [
    ...(db
      .prepare(`SELECT id, name, category, history, player_text, avatar_image_path, thumbnail_image_path FROM setting_beings WHERE setting_id = ? AND id IN (${inClause(beiOpen)})`)
      .all(settingId, ...beiOpen) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "open" as const })),
    ...(db
      .prepare(`SELECT id, name, category, avatar_image_path, thumbnail_image_path FROM setting_beings WHERE setting_id = ? AND id IN (${inClause(beiMentioned)})`)
      .all(settingId, ...beiMentioned) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "mentioned" as const })),
  ];
  const communities = [
    ...(db
      .prepare(`SELECT id, name, description, player_text, avatar_image_path, thumbnail_image_path FROM setting_communities WHERE setting_id = ? AND id IN (${inClause(comOpen)})`)
      .all(settingId, ...comOpen) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "open" as const })),
    ...(db
      .prepare(`SELECT id, name, avatar_image_path, thumbnail_image_path FROM setting_communities WHERE setting_id = ? AND id IN (${inClause(comMentioned)})`)
      .all(settingId, ...comMentioned) as Record<string, unknown>[]).map((r) => ({ ...withImageUrls(r as { avatar_image_path: string | null; thumbnail_image_path: string | null }), access_level: "mentioned" as const })),
  ];
  const chronicleEvents = [
    ...(db
      .prepare(`SELECT id, title, description, player_text, inworld_year, inworld_month, inworld_day FROM setting_calendar_events WHERE setting_id = ? AND id IN (${inClause(evOpen)})`)
      .all(settingId, ...evOpen) as Record<string, unknown>[]).map((r) => ({ ...r, access_level: "open" as const })),
    ...(db
      .prepare(`SELECT id, title, inworld_year, inworld_month, inworld_day FROM setting_calendar_events WHERE setting_id = ? AND id IN (${inClause(evMentioned)})`)
      .all(settingId, ...evMentioned) as Record<string, unknown>[]).map((r) => ({ ...r, access_level: "mentioned" as const })),
  ];

  return { locations, beings, communities, chronicleEvents };
}

// Открытое старой галочкой «Видно игрокам» — главы локаций и существ и
// события хроники сеттинга. Галочка стоит на самой записи сеттинга, поэтому
// видна всем игрокам всех кампаний на нём, без грантов. У игрока это лежит во
// вкладке «Мир» рядом с выданным (F-52, 2026-09-18), и превью «Глазами
// игрока» обязано показывать то же — отсюда одна функция на оба входа.
export interface FlaggedSettingContent {
  locationArticles: Record<string, unknown>[];
  beingArticles: Record<string, unknown>[];
  chronicleEvents: Record<string, unknown>[];
}

export function getFlaggedSettingContent(settingId: number | null): FlaggedSettingContent {
  if (!settingId) return { locationArticles: [], beingArticles: [], chronicleEvents: [] };
  const locationArticles = db
    .prepare(
      `SELECT lc.id, lc.title, lc.content, lc.created_at, sl.name as location_name
       FROM location_chapters lc JOIN setting_locations sl ON sl.id = lc.location_id
       WHERE sl.setting_id = ? AND lc.visible_to_players = 1
       ORDER BY lc.created_at DESC`
    )
    .all(settingId) as Record<string, unknown>[];
  const beingArticles = db
    .prepare(
      `SELECT bc.id, bc.title, bc.content, bc.created_at, sb.name as being_name
       FROM being_chapters bc JOIN setting_beings sb ON sb.id = bc.being_id
       WHERE sb.setting_id = ? AND bc.visible_to_players = 1
       ORDER BY bc.created_at DESC`
    )
    .all(settingId) as Record<string, unknown>[];
  const chronicleEvents = db
    .prepare(
      `SELECT id, title, description, inworld_year, inworld_month, inworld_day
       FROM setting_calendar_events
       WHERE setting_id = ? AND visible_to_players = 1
       ORDER BY inworld_year DESC, inworld_month DESC, inworld_day DESC`
    )
    .all(settingId) as Record<string, unknown>[];
  return { locationArticles, beingArticles, chronicleEvents };
}

// «От мастера» для игрока: разделы и статьи кампании по грантам. Раздел
// входит целиком, если открыт сам, — иначе только открыто выданные статьи;
// галерея — только целиком.
export function getPlayerSectionsFor(campaignId: number, playerId: number): Record<string, unknown>[] {
  const grantRows = db
    .prepare(
      "SELECT target_type, target_id FROM player_visibility_grants WHERE campaign_id = ? AND player_id = ?"
    )
    .all(campaignId, playerId) as { target_type: string; target_id: number }[];
  const grantedSectionIds = new Set(
    grantRows.filter((g) => g.target_type === "campaign_player_section").map((g) => g.target_id)
  );
  const grantedArticleIds = new Set(
    grantRows.filter((g) => g.target_type === "campaign_player_article").map((g) => g.target_id)
  );

  const allSections = db
    .prepare("SELECT * FROM campaign_player_sections WHERE campaign_id = ? ORDER BY position, id")
    .all(campaignId) as { id: number; kind: string; name: string }[];

  const gallerySectionIds = allSections.filter((s) => s.kind === "gallery" && grantedSectionIds.has(s.id)).map((s) => s.id);
  const galleryImagesBySection = new Map<number, { image_path: string; image_url: string }[]>();
  if (gallerySectionIds.length) {
    const galleryRows = db
      .prepare(
        `SELECT * FROM gallery_images WHERE owner_type = 'campaign_player_section' AND owner_id IN (${inClause(gallerySectionIds)}) ORDER BY position, id`
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
    const articleRows = db
      .prepare(`SELECT * FROM campaign_player_articles WHERE section_id IN (${inClause(articleSectionIds)}) ORDER BY position, id`)
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
  return result;
}
