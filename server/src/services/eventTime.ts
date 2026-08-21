// Время события: точность, период, статус.
//
// Одно место на обе таблицы событий (setting_calendar_events и
// campaign_calendar_events): поля у них одинаковые, и разъехаться они не
// должны — иначе в хронике период можно, а в расписании нет, и объяснять это
// Мастеру нечем.

import { db } from "../db/db";

export const DATE_PRECISIONS = ["century", "decade", "year", "month", "day"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const EVENT_STATUSES = ["upcoming", "happened", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export function isPrecision(v: unknown): v is DatePrecision {
  return typeof v === "string" && (DATE_PRECISIONS as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is EventStatus {
  return typeof v === "string" && (EVENT_STATUSES as readonly string[]).includes(v);
}

/**
 * Статус нового события по умолчанию: раньше «сейчас» — случилось, позже —
 * предстоит.
 *
 * Это не догадка ради догадки, а единственный ответ, верный почти всегда:
 * событие 1200 года в мире, где сейчас 1496-й, предстоящим быть не может.
 * Ошибётся на пророчестве, датированном задним числом, — там Мастер поправит
 * одним щелчком.
 *
 * «Сейчас» не задано — считаем «случилось»: прошлое вероятнее, и ошибка в эту
 * сторону тише.
 */
export function defaultStatus(
  year: number,
  month: number,
  now: { year: number | null; month: number | null }
): EventStatus {
  if (now.year == null) return "happened";
  if (year > now.year) return "upcoming";
  if (year < now.year) return "happened";
  return month > (now.month ?? 0) ? "upcoming" : "happened";
}

/** «Сейчас» сеттинга — закреплённая дата мира. */
export function settingNow(settingId: number): { year: number | null; month: number | null } {
  const row = db
    .prepare("SELECT pinned_calendar_year AS year, pinned_calendar_month AS month FROM settings WHERE id = ?")
    .get(settingId) as { year: number | null; month: number | null } | undefined;
  return row ?? { year: null, month: null };
}

/**
 * «Сейчас» кампании: закреплённая дата, а если её нет — внутриигровая дата
 * последней проведённой сессии.
 *
 * Порядок именно такой. Всегда брать последнюю сессию соблазнительно
 * автоматикой, но она врёт в двух обычных случаях: между сессиями прошёл месяц
 * игрового времени в переписке, или сессия кончилась на клиффхэнгере и дата
 * ещё не та. Мастер должен уметь сказать «сейчас вот здесь» и не спорить с
 * программой. А если он ничего не сказал — последняя сессия лучше пустоты.
 */
export function campaignNow(campaignId: number): { year: number | null; month: number | null } {
  const pinned = db
    .prepare(
      "SELECT pinned_calendar_year AS year, pinned_calendar_month AS month FROM campaigns WHERE id = ?"
    )
    .get(campaignId) as { year: number | null; month: number | null } | undefined;
  if (pinned?.year != null) return pinned;
  const session = db
    .prepare(
      `SELECT inworld_year AS year, inworld_month AS month FROM sessions
       WHERE campaign_id = ? AND inworld_year IS NOT NULL AND status = 'held' AND archived_at IS NULL
       ORDER BY inworld_year DESC, inworld_month DESC, inworld_day DESC LIMIT 1`
    )
    .get(campaignId) as { year: number | null; month: number | null } | undefined;
  return session ?? { year: null, month: null };
}

/**
 * Поля времени из тела запроса — в пары «колонка = значение» для UPDATE.
 *
 * Конец периода принимается и как значение, и как явный null: COALESCE не
 * отличает «не передали» от «очистили», а период надо уметь снять — событие
 * перестало быть растянутым.
 */
export function timePatch(body: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (isPrecision(body.date_precision)) {
    sets.push("date_precision = ?");
    values.push(body.date_precision);
  }
  if (isStatus(body.status)) {
    sets.push("status = ?");
    values.push(body.status);
  }
  if (body.cancel_note !== undefined) {
    sets.push("cancel_note = ?");
    values.push(String(body.cancel_note));
  }
  for (const column of ["inworld_year_end", "inworld_month_end", "inworld_day_end"] as const) {
    if (body[column] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(body[column] === null ? null : Number(body[column]));
  }
  return { sets, values };
}
