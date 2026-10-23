import { parseDateKey } from "../../utils/date";
import { SESSION_OUTCOME_FIELDS, SESSION_PASSPORT_FIELDS } from "../sessionPaperFields";
import type { SessionSummary } from "../../types";

// Раскладка вкладки «Сессии» по группам (гриллинг 2026-10-23, Q5/Q11/Q15).

const monthName = new Intl.DateTimeFormat("ru", { month: "long" });

export interface SessionGroups {
  /** Дата прошла, а разбора не было: деньги и посещаемость пока врут. */
  overdue: SessionSummary[];
  planned: SessionSummary[];
  /** Сыгранные по месяцам, от последнего. */
  months: { key: string; title: string; sessions: SessionSummary[] }[];
}

/** Игроку разбирать нечего — прошедшая игра у него среди сыгранных (Q15). */
export function groupSessions(sessions: SessionSummary[], today: string, isGm: boolean): SessionGroups {
  const byDate = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const isOverdue = (s: SessionSummary) => s.status === "planned" && s.date < today;
  const held = byDate.filter((s) => s.status === "held" || (!isGm && isOverdue(s))).reverse();
  const months: SessionGroups["months"] = [];
  for (const s of held) {
    const key = s.date.slice(0, 7);
    let m = months[months.length - 1];
    if (m?.key !== key) {
      const name = monthName.format(parseDateKey(s.date));
      m = { key, title: `${name[0].toUpperCase()}${name.slice(1)} ${key.slice(0, 4)}`, sessions: [] };
      months.push(m);
    }
    m.sessions.push(s);
  }
  return {
    overdue: isGm ? byDate.filter(isOverdue) : [],
    planned: byDate.filter((s) => s.status === "planned" && s.date >= today),
    months,
  };
}

/**
 * Хвосты сыгранной (Q8): посещаемость 0 из N — разбора не было, а не неявка
 * (решение владельца после шага 1); «3 из 4» — только при частичной неявке.
 */
export function heldTails(s: SessionSummary): { unreviewed: boolean; attendance: string | null; unpaid: number } {
  const came = s.attended_count ?? 0;
  const all = s.attendance_total ?? 0;
  return {
    unreviewed: all > 0 && came === 0,
    attendance: came > 0 && came < all ? `${came} из ${all}` : null,
    unpaid: s.unpaid_count ?? 0,
  };
}

/** Подготовка ближайшей (Q9): заполненные поля паспорта вечера из всех. */
export function passportDone(values: Record<string, string | undefined>): { done: number; total: number } {
  return { done: SESSION_PASSPORT_FIELDS.filter((f) => values[f.key]?.trim()).length, total: SESSION_PASSPORT_FIELDS.length };
}

/** «Что изменилось» заполнено хоть по одной оси. */
export function hasOutcome(outcomes: Record<string, string | undefined> | undefined): boolean {
  return SESSION_OUTCOME_FIELDS.some((f) => outcomes?.[f.key]?.trim());
}

export function daysUntilLabel(date: string, today: string): string {
  const days = Math.round((parseDateKey(date).getTime() - parseDateKey(today).getTime()) / 86400000);
  return days === 0 ? "сегодня" : days === 1 ? "завтра" : `через ${days} дн.`;
}
