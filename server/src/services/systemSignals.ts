import type { NextFunction, Response } from "express";
import { db } from "../db/db";
import type { AuthedRequest } from "./auth";
import { playersOfCampaign } from "./campaignSignals";

/**
 * Сигнал «компендиум системы изменился» (docs/adr/0001, группа «системы»,
 * часть 2; разбор Q3, Q5).
 *
 * Лист игрока берёт заклинания, умения и снаряжение из компендиума системы.
 * Мастер поправил за столом урон предмета — открытый лист игрока должен
 * увидеть это сам, а не после перезагрузки. Сигнал несёт только номер
 * системы: лист перечитывает свои записи одной пачкой.
 *
 * Получатели — игроки живых кампаний на этой системе и владельцы персонажей
 * без кампании, привязанных к ней напрямую (лист, собранный заранее).
 */

type Req = AuthedRequest & { body?: Record<string, unknown> };

interface Rule {
  pattern: RegExp;
  resolve: (req: Req, match: RegExpMatchArray) => number[];
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function column(sql: string, ...params: unknown[]): number[] {
  try {
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => num(Object.values(r)[0])).filter((n): n is number => n != null);
  } catch {
    return [];
  }
}

const ENTRY_SYSTEM = "SELECT system_id FROM compendium_entries WHERE id = ?";

const RULES: Rule[] = [
  // Главы записи (история, поведение существа).
  {
    pattern: /^\/systems\/entries\/chapters\/(\d+)\/?$/,
    resolve: (_r, m) =>
      column("SELECT e.system_id FROM compendium_entry_chapters c JOIN compendium_entries e ON e.id = c.entry_id WHERE c.id = ?", m[1]),
  },
  // Избранное — личная пометка Мастера, листам игроков до неё дела нет.
  { pattern: /^\/systems\/entries\/\d+\/favourite\/?$/, resolve: () => [] },
  // Запись: поля, аватар, главы, удаление.
  { pattern: /^\/systems\/entries\/(\d+)(\/|$)/, resolve: (_r, m) => column(ENTRY_SYSTEM, m[1]) },
  // Разделы системы: переименование и удаление раздела уносят его записи.
  { pattern: /^\/systems\/sections\/(\d+)\/?$/, resolve: (_r, m) => column("SELECT system_id FROM system_sections WHERE id = ?", m[1]) },
  // Всё под системой: новая запись, порядок, разделы, уборка, обновление из файла.
  { pattern: /^\/systems\/(\d+)\/(entries|sections|tidy|update|update-file)(\/|$)/, resolve: (_r, m) => [Number(m[1])] },
  // Импорт по ключам и его откат.
  { pattern: /^\/system-import\/apply\/?$/, resolve: (r) => [num(r.body?.system_id)].filter((n): n is number => n != null) },
  { pattern: /^\/system-import\/batches\/(\d+)\/?$/, resolve: (_r, m) => column("SELECT system_id FROM system_import_batches WHERE id = ?", m[1]) },
];

function unique(list: number[]): number[] {
  return [...new Set(list)];
}

/** Системы, чей компендиум задевает запрос; путь — без префикса `/api`. */
export function systemsTouchedBy(req: Req, path: string): number[] {
  for (const rule of RULES) {
    const match = path.match(rule.pattern);
    if (match) return unique(rule.resolve(req, match));
  }
  return [];
}

/** Игроки, чьи листы читают компендиум системы. */
export function playersOfSystem(systemId: number): number[] {
  const campaigns = column("SELECT id FROM campaigns WHERE system_id = ? AND archived_at IS NULL", systemId);
  const standalone = column(
    "SELECT player_id FROM characters WHERE campaign_id IS NULL AND system_id = ? AND archived_at IS NULL",
    systemId
  );
  return unique([...campaigns.flatMap(playersOfCampaign), ...standalone]);
}

export type SystemSignalEmit = (room: string, payload: { systemId: number }) => void;

/**
 * Прослойка на `/api`: после удачной записи в компендиум шлёт
 * `system-data-changed` в личную комнату каждого игрока системы. Мастеру не
 * шлёт: компендиум пишет только он, а другие его окна узнают о правке своим
 * каналом.
 */
export function systemSignalMiddleware(emit: SystemSignalEmit) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const r = req as Req;
    const path = req.path;
    let before: number[] = [];
    try {
      before = systemsTouchedBy(r, path);
    } catch {
      before = [];
    }
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      let after: number[] = [];
      try {
        after = systemsTouchedBy(r, path);
      } catch {
        after = [];
      }
      for (const systemId of unique([...before, ...after])) {
        for (const playerId of playersOfSystem(systemId)) emit(`player:${playerId}`, { systemId });
      }
    });
    next();
  };
}
