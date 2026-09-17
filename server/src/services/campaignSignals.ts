import type { NextFunction, Response } from "express";
import { db } from "../db/db";
import type { AuthedRequest } from "./auth";

/**
 * Сигнал «данные кампании изменились» (docs/adr/0001, группа «кампании»,
 * часть 3; разбор Q3–Q6).
 *
 * Мастер выдал предмет, открыл тайну или раздел — открытый экран игрока должен
 * увидеть это сам, без перезагрузки. И наоборот: запись игрока в дневник или
 * цитаты доходит до Мастера. Сигнал несёт только номер кампании — никакого
 * содержимого: получатель перечитывает свои данные сам, со своими правами, и
 * узнать из сигнала то, что ему не видно, нельзя.
 *
 * Кампания определяется по правилам ниже ДО обработки запроса (удалённую
 * строку потом не найти) и ещё раз ПОСЛЕ (у загрузки файла поля формы
 * появляются только после multer). Сигнал уходит, только если ответ удачный.
 */

type Req = AuthedRequest & { body?: Record<string, unknown>; query: Record<string, unknown> };

interface Rule {
  pattern: RegExp;
  /** Номера кампаний по совпадению пути; пустой массив — не определилась. */
  resolve: (req: Req, match: RegExpMatchArray) => number[];
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function ids(...values: unknown[]): number[] {
  return values.map(num).filter((n): n is number => n != null);
}

function column(sql: string, ...params: unknown[]): number[] {
  try {
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return ids(...rows.map((r) => Object.values(r)[0]));
  } catch {
    return [];
  }
}

function fromBodyOrQuery(req: Req): number[] {
  return ids(req.body?.campaign_id, req.query.campaign_id);
}

/** Все кампании сеттинга: игроцкий текст и видимые статьи сеттинга видят они все. */
function campaignsOfSetting(settingSql: string, id: string): number[] {
  return column(`SELECT id FROM campaigns WHERE setting_id = (${settingSql}) AND archived_at IS NULL`, id);
}

const RULES: Rule[] = [
  // Кампания и всё под ней (состав, закреплённый месяц, изображения).
  { pattern: /^\/campaigns\/(\d+)(\/|$)/, resolve: (_r, m) => ids(m[1]) },
  // Сессии: расписание и итоги, открытые игрокам.
  { pattern: /^\/sessions\/?$/, resolve: (r) => fromBodyOrQuery(r) },
  { pattern: /^\/sessions\/(\d+)(\/|$)/, resolve: (_r, m) => column("SELECT campaign_id FROM sessions WHERE id = ?", m[1]) },
  // Доступы и включение в панель игроков.
  { pattern: /^\/visibility-grants(\/batch)?\/?$/, resolve: (r) => fromBodyOrQuery(r) },
  { pattern: /^\/campaign-setting-entities\/(\d+)(\/|$)/, resolve: (_r, m) => ids(m[1]) },
  // «От мастера»: подразделы, статьи, порядок.
  { pattern: /^\/campaign-player-sections\/?$/, resolve: (r) => fromBodyOrQuery(r) },
  {
    pattern: /^\/campaign-player-sections\/reorder\/?$/,
    resolve: (r) => orderCampaigns("SELECT campaign_id FROM campaign_player_sections WHERE id = ?", r),
  },
  {
    pattern: /^\/campaign-player-sections\/articles\/reorder\/?$/,
    resolve: (r) =>
      orderCampaigns(
        "SELECT s.campaign_id FROM campaign_player_articles a JOIN campaign_player_sections s ON s.id = a.section_id WHERE a.id = ?",
        r
      ),
  },
  {
    pattern: /^\/campaign-player-sections\/articles\/(\d+)\/?$/,
    resolve: (_r, m) =>
      column(
        "SELECT s.campaign_id FROM campaign_player_articles a JOIN campaign_player_sections s ON s.id = a.section_id WHERE a.id = ?",
        m[1]
      ),
  },
  {
    pattern: /^\/campaign-player-sections\/(\d+)(\/|$)/,
    resolve: (_r, m) => column("SELECT campaign_id FROM campaign_player_sections WHERE id = ?", m[1]),
  },
  // Галерея подраздела «От мастера».
  { pattern: /^\/gallery\/?$/, resolve: (r) => galleryOwner(r.body?.owner_type, r.body?.owner_id) },
  {
    pattern: /^\/gallery\/(\d+)\/?$/,
    resolve: (_r, m) => {
      const row = db.prepare("SELECT owner_type, owner_id FROM gallery_images WHERE id = ?").get(m[1]) as
        | { owner_type: string; owner_id: number }
        | undefined;
      return row ? galleryOwner(row.owner_type, row.owner_id) : [];
    },
  },
  // Тайны, вехи, сцены: отметки кампании и её собственные записи.
  { pattern: /^\/story\/(secrets|milestones|scenes)\/\d+\/state\/?$/, resolve: (r) => fromBodyOrQuery(r) },
  { pattern: /^\/story\/(secrets|milestones)\/?$/, resolve: (r) => fromBodyOrQuery(r) },
  { pattern: /^\/story\/secrets\/(\d+)\/?$/, resolve: (_r, m) => column("SELECT campaign_id FROM story_secrets WHERE id = ?", m[1]) },
  { pattern: /^\/story\/campaign-adventures\/?$/, resolve: (r) => fromBodyOrQuery(r) },
  // Персонажи — «Группа» у игрока.
  { pattern: /^\/characters\/?$/, resolve: (r) => fromBodyOrQuery(r) },
  { pattern: /^\/characters\/(\d+)(\/|$)/, resolve: (_r, m) => column("SELECT campaign_id FROM characters WHERE id = ?", m[1]) },
  // Записи кампании (цитаты, заметки) — их пишут и игроки, и Мастер.
  { pattern: /^\/campaign-entries\/?$/, resolve: (r) => fromBodyOrQuery(r) },
  { pattern: /^\/campaign-entries\/(\d+)\/?$/, resolve: (_r, m) => column("SELECT campaign_id FROM campaign_entries WHERE id = ?", m[1]) },
  // Сеттинг: игроцкий текст, видимые статьи и хроника — видны всем его кампаниям.
  {
    pattern: /^\/setting-locations\/chapters\/(\d+)\/?$/,
    resolve: (_r, m) =>
      campaignsOfSetting("SELECT l.setting_id FROM location_chapters c JOIN setting_locations l ON l.id = c.location_id WHERE c.id = ?", m[1]),
  },
  {
    pattern: /^\/setting-beings\/chapters\/(\d+)\/?$/,
    resolve: (_r, m) =>
      campaignsOfSetting("SELECT b.setting_id FROM being_chapters c JOIN setting_beings b ON b.id = c.being_id WHERE c.id = ?", m[1]),
  },
  {
    pattern: /^\/setting-communities\/chapters\/(\d+)\/?$/,
    resolve: (_r, m) =>
      campaignsOfSetting(
        "SELECT s.setting_id FROM community_chapters c JOIN setting_communities s ON s.id = c.community_id WHERE c.id = ?",
        m[1]
      ),
  },
  { pattern: /^\/setting-locations\/(\d+)(\/|$)/, resolve: (_r, m) => campaignsOfSetting("SELECT setting_id FROM setting_locations WHERE id = ?", m[1]) },
  { pattern: /^\/setting-beings\/(\d+)(\/|$)/, resolve: (_r, m) => campaignsOfSetting("SELECT setting_id FROM setting_beings WHERE id = ?", m[1]) },
  {
    pattern: /^\/setting-communities\/(\d+)(\/|$)/,
    resolve: (_r, m) => campaignsOfSetting("SELECT setting_id FROM setting_communities WHERE id = ?", m[1]),
  },
  {
    pattern: /^\/settings\/calendar-events\/(\d+)\/?$/,
    resolve: (_r, m) => campaignsOfSetting("SELECT setting_id FROM setting_calendar_events WHERE id = ?", m[1]),
  },
  { pattern: /^\/settings\/(\d+)\/calendar-events\/?$/, resolve: (_r, m) => campaignsOfSetting("SELECT ?", m[1]) },
  // Игрок: дневник кампании.
  { pattern: /^\/player\/campaigns\/(\d+)\/world-entries\/?$/, resolve: (_r, m) => ids(m[1]) },
  {
    pattern: /^\/player\/world-entries\/reorder\/?$/,
    resolve: (r) => {
      const list = Array.isArray(r.body?.ids) ? (r.body?.ids as unknown[]) : [];
      return unique(list.flatMap((id) => column("SELECT campaign_id FROM world_exploration_entries WHERE id = ?", id)));
    },
  },
  {
    pattern: /^\/player\/world-entries\/(\d+)(\/|$)/,
    resolve: (_r, m) => column("SELECT campaign_id FROM world_exploration_entries WHERE id = ?", m[1]),
  },
];

function unique(list: number[]): number[] {
  return [...new Set(list)];
}

function orderCampaigns(sql: string, req: Req): number[] {
  const order = Array.isArray(req.body?.order) ? (req.body?.order as unknown[]) : [];
  return unique(order.flatMap((id) => column(sql, id)));
}

function galleryOwner(ownerType: unknown, ownerId: unknown): number[] {
  if (ownerType !== "campaign_player_section") return [];
  return column("SELECT campaign_id FROM campaign_player_sections WHERE id = ?", ownerId);
}

/** Кампании, которых касается запрос; путь — без префикса `/api`. */
export function campaignsTouchedBy(req: Req, path: string): number[] {
  for (const rule of RULES) {
    const match = path.match(rule.pattern);
    if (match) return unique(rule.resolve(req, match));
  }
  return [];
}

/** Игроки кампании: состав и владельцы её персонажей. */
export function playersOfCampaign(campaignId: number): number[] {
  return column(
    `SELECT player_id FROM campaign_roster WHERE campaign_id = ?
     UNION SELECT player_id FROM characters WHERE campaign_id = ? AND archived_at IS NULL`,
    campaignId,
    campaignId
  );
}

export type CampaignSignalEmit = (room: string, payload: { campaignId: number }) => void;

/**
 * Прослойка на `/api`: после удачной записи шлёт `campaign-data-changed`
 * каждому игроку задетой кампании (в его личную комнату — так до него доходит
 * и кампания, куда его добавили уже после подключения), а если писал игрок —
 * ещё и Мастеру. Правку Мастера другие окна Мастера получают своим каналом.
 */
export function campaignSignalMiddleware(emit: CampaignSignalEmit) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const r = req as Req;
    const path = req.path;
    let before: number[] = [];
    try {
      before = campaignsTouchedBy(r, path);
    } catch {
      before = [];
    }
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      let after: number[] = [];
      try {
        after = campaignsTouchedBy(r, path);
      } catch {
        after = [];
      }
      const campaigns = unique([...before, ...after]);
      const fromPlayer = req.user?.role === "player";
      for (const campaignId of campaigns) {
        for (const playerId of playersOfCampaign(campaignId)) emit(`player:${playerId}`, { campaignId });
        if (fromPlayer) emit("gm", { campaignId });
      }
    });
    next();
  };
}
