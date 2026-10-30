import { cycleElements, dayInTurn, elementDays } from "../../cycles";
import { daysInYear, elapsedDays } from "../../inworldCalendar";
import type { CalendarMonth, SettingCycle } from "../../types";

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
  status: string;
  inworld_year: number;
  inworld_month: number;
  inworld_day: number;
  inworld_year_end: number | null;
  inworld_month_end: number | null;
  inworld_day_end: number | null;
}

const key = (y: number, m: number, d: number) => (y * 1000 + m) * 100 + d;

/**
 * Тон к «сейчас». Без дня у «сейчас» сравнение идёт по месяцам: «идёт» —
 * только период, накрывший этот месяц, а точечное событие внутри месяца
 * решает статус. С днём — по дням.
 */
export function timeTone(ev: TonedEvent, now: ChronicleNow | null): TimeTone {
  if (ev.status === "cancelled") return "off";
  if (now) {
    const byDay = now.day != null;
    const n = key(now.year, now.month, byDay ? now.day! : 0);
    const start = key(ev.inworld_year, ev.inworld_month, byDay ? ev.inworld_day : 0);
    const end =
      ev.inworld_year_end != null
        ? key(ev.inworld_year_end, ev.inworld_month_end ?? 999, byDay ? (ev.inworld_day_end ?? 99) : 0)
        : byDay
          ? start
          : null;
    if (end != null && start <= n && n <= end) return "on";
    if (start > n) return "up";
    if (byDay && end != null && end < n) return "past";
  }
  return ev.status === "upcoming" ? "up" : "past";
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
