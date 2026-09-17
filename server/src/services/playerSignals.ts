import type { NextFunction, Response } from "express";
import { db } from "../db/db";
import type { AuthedRequest } from "./auth";
import { playersOfCampaign } from "./campaignSignals";

/**
 * Сигнал «запись игрока изменилась» (docs/adr/0001, группа «остальное»,
 * часть 2; разбор Q5).
 *
 * Мастер переименовал игрока в профиле — открытый кабинет игрока («Привет, …»)
 * и состав партии у его товарищей по кампаниям должны увидеть новое имя сами.
 * Напоминание Мастера игроку — только ему: оно лежит на его главной. Сигнал
 * несёт лишь номер игрока, получатель перечитывает своё сам.
 *
 * Обложка и аватар игрока — Мастерские картинки раздела «Игроки», игроку не
 * показываются: сигнала нет.
 */

interface Rule {
  pattern: RegExp;
  /** Кому слать: только сам игрок или ещё и игроки его кампаний. */
  audience: "self" | "party" | "none";
}

const RULES: Rule[] = [
  { pattern: /^\/players\/\d+\/(thumbnail|avatar)\/?$/, audience: "none" },
  { pattern: /^\/players\/\d+\/reminders(\/|$)/, audience: "self" },
  // Поля, архивирование и возврат.
  { pattern: /^\/players\/\d+(\/restore)?\/?$/, audience: "party" },
];

function column(sql: string, ...params: unknown[]): number[] {
  try {
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => Number(Object.values(r)[0])).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/** Кабинеты, которым показывается запись игрока; путь — без префикса `/api`. */
export function recipientsOfPlayerWrite(path: string): { playerId: number; recipients: number[] } | null {
  const id = path.match(/^\/players\/(\d+)(\/|$)/);
  if (!id) return null;
  const playerId = Number(id[1]);
  const rule = RULES.find((r) => r.pattern.test(path));
  if (!rule || rule.audience === "none") return null;
  if (rule.audience === "self") return { playerId, recipients: [playerId] };
  // Живые кампании игрока: состав и те, где у него есть персонаж.
  const campaigns = column(
    `SELECT cr.campaign_id FROM campaign_roster cr JOIN campaigns c ON c.id = cr.campaign_id
       WHERE cr.player_id = ? AND c.archived_at IS NULL
     UNION SELECT ch.campaign_id FROM characters ch JOIN campaigns c ON c.id = ch.campaign_id
       WHERE ch.player_id = ? AND ch.archived_at IS NULL AND c.archived_at IS NULL`,
    playerId,
    playerId
  );
  const recipients = new Set([playerId]);
  for (const campaignId of campaigns) for (const p of playersOfCampaign(campaignId)) recipients.add(p);
  return { playerId, recipients: [...recipients] };
}

export type PlayerSignalEmit = (room: string, payload: { playerId: number }) => void;

/**
 * Прослойка на `/api`: после удачной записи в `/players/:id` шлёт
 * `player-data-changed` в личные комнаты получателей. Мастеру не шлёт: пишет
 * только он, другие его окна узнают о правке своим каналом.
 */
export function playerSignalMiddleware(emit: PlayerSignalEmit) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const path = req.path;
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      let target: ReturnType<typeof recipientsOfPlayerWrite> = null;
      try {
        target = recipientsOfPlayerWrite(path);
      } catch {
        target = null;
      }
      if (!target) return;
      for (const playerId of target.recipients) emit(`player:${playerId}`, { playerId: target.playerId });
    });
    next();
  };
}
