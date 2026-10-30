import { cycleElements, dayInTurn, elementDays } from "../../cycles";
import { daysInYear, elapsedDays } from "../../inworldCalendar";
import type { CalendarMonth, SettingCycle } from "../../types";

// «Сейчас» сеттинга — закреплённый месяц (дня у сеттинга нет). Сезон —
// элемент первого годового цикла сеттинга в середине этого месяца: отдельного
// поля «сезон» в модели нет, а «Времена года» Мастер заводит циклом.

export function pinnedMonthName(months: CalendarMonth[], month: number | null | undefined): string | null {
  return months.find((m) => m.position === month)?.name ?? null;
}

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
  return hit?.name ?? null;
}
