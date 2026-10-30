import { cycleElements, dayInTurn, elementDays } from "../../cycles";
import { daysInYear, elapsedDays } from "../../inworldCalendar";
import type { CalendarMonth, DatePrecision, SettingCycle, SessionSummary } from "../../types";

// Время Хроники — общее у сеттинга и кампании (решение владельца 2026-10-30:
// один каркас). «Сейчас» приходит снаружи: у сеттинга — закреплённый месяц,
// у кампании — закреплённый месяц или дата последней сессии (с днём или без).

/** «Сейчас» Хроники. День есть, когда источник его знает. */
export interface ChronicleNow {
  year: number;
  month: number;
  day?: number | null;
}

/** Тон времени события: прошло · идёт · предстоит · отменено. */
export type TimeTone = "past" | "on" | "up" | "off";
export const TONES: readonly TimeTone[] = ["past", "on", "up", "off"];
export const TONE_LABEL: Record<TimeTone, string> = { past: "Прошло", on: "Идёт", up: "Предстоит", off: "Отменено" };

/** Что тону нужно от события — поля есть и у события сеттинга, и у события кампании. */
export interface TonedEvent {
  status?: string;
  date_precision?: DatePrecision | null;
  inworld_year: number;
  inworld_month: number;
  inworld_day: number;
  inworld_year_end?: number | null;
  inworld_month_end?: number | null;
  inworld_day_end?: number | null;
}

export const dateKey = (y: number, m: number, d: number) => (y * 1000 + m) * 100 + d;

/** Перенесено из codex/campaign-chronicle: цвет — статус, «идёт» — только период. */
export function timeTone(ev: TonedEvent, now: ChronicleNow | null): TimeTone {
  if (ev.status === "cancelled") return "off";
  if (now && (ev.inworld_year_end != null || ev.inworld_month_end != null || ev.inworld_day_end != null)) {
    const byDay = now.day != null;
    const start = dateKey(ev.inworld_year, ev.inworld_month, byDay ? ev.inworld_day : 0);
    const end = dateKey(ev.inworld_year_end ?? ev.inworld_year, ev.inworld_month_end ?? ev.inworld_month, byDay ? (ev.inworld_day_end ?? ev.inworld_day) : 0);
    const n = dateKey(now.year, now.month, byDay ? now.day! : 0);
    if (start <= n && n <= end) return "on";
  }
  return ev.status === "upcoming" ? "up" : "past";
}

/** Периоды включают оба конца; неточная дата не обещает точный день. */
export function eventOccursOn(ev: TonedEvent, at: { year: number; month: number; day: number }): boolean {
  const start = dateKey(ev.inworld_year, ev.inworld_month, ev.inworld_day);
  const n = dateKey(at.year, at.month, at.day);
  if (ev.inworld_year_end != null || ev.inworld_month_end != null || ev.inworld_day_end != null) {
    return start <= n && n <= dateKey(ev.inworld_year_end ?? ev.inworld_year, ev.inworld_month_end ?? ev.inworld_month, ev.inworld_day_end ?? ev.inworld_day);
  }
  switch (ev.date_precision) {
    case "century": return Math.floor((ev.inworld_year - 1) / 100) === Math.floor((at.year - 1) / 100);
    case "decade": return Math.floor((ev.inworld_year - 1) / 10) === Math.floor((at.year - 1) / 10);
    case "year": return ev.inworld_year === at.year;
    case "month": return ev.inworld_year === at.year && ev.inworld_month === at.month;
    default: return start === n;
  }
}

export function campaignClock(campaign: { pinned_calendar_year: number | null; pinned_calendar_month: number | null }, sessions: readonly SessionSummary[]) {
  if (campaign.pinned_calendar_year != null && campaign.pinned_calendar_month != null) {
    return { now: { year: campaign.pinned_calendar_year, month: campaign.pinned_calendar_month } as ChronicleNow, source: "закреплённый месяц" };
  }
  const dated = sessions.filter((s) => s.status === "held" && s.inworld_year != null).sort((a, b) =>
    dateKey(b.inworld_year_end ?? b.inworld_year!, b.inworld_month_end ?? b.inworld_month ?? 1, b.inworld_day_end ?? b.inworld_day ?? 1) -
    dateKey(a.inworld_year_end ?? a.inworld_year!, a.inworld_month_end ?? a.inworld_month ?? 1, a.inworld_day_end ?? a.inworld_day ?? 1) || b.id - a.id);
  const last = dated[0];
  return { now: last ? { year: last.inworld_year_end ?? last.inworld_year!, month: last.inworld_month_end ?? last.inworld_month ?? 1, day: last.inworld_day_end ?? last.inworld_day ?? undefined } : null,
    source: last ? `по ${last.session_number ? `сессии №${last.session_number}` : "последней сессии"}` : "" };
}

/**
 * Сезон — элемент первого годового цикла (период = длина года) в середине
 * месяца: отдельного поля «сезон» в модели нет, «Времена года» заводят циклом.
 */
export function seasonAt(cycles: readonly SettingCycle[], months: CalendarMonth[], year: number, month: number): string | null {
  const yearDays = daysInYear(months);
  const m = months.find((x) => x.position === month);
  if (!yearDays || !m) return null;
  const yearly = cycles.filter((c) => c.campaign_id == null && c.period_days === yearDays && c.points.length > 0).sort((a, b) => a.position - b.position)[0];
  if (!yearly) return null;
  const anchor = elapsedDays(yearly.anchor_year, yearly.anchor_month, yearly.anchor_day, months);
  const day = dayInTurn(elapsedDays(year, month, Math.ceil(m.days / 2), months), anchor, yearly.period_days);
  const hit = cycleElements(yearly).find((el) => {
    const into = (((day - el.day_offset) % yearly.period_days) + yearly.period_days) % yearly.period_days;
    return into < elementDays(el, yearly.period_days);
  });
  return hit ? hit.name.charAt(0).toUpperCase() + hit.name.slice(1) : null;
}

export const monthName = (months: CalendarMonth[], month: number) => months.find((m) => m.position === month)?.name ?? `${month}-й месяц`;
