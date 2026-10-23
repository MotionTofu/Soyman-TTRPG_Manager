import { parseDateKey } from "../../utils/date";
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
