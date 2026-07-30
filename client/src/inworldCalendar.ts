import type { CalendarMonth, ImportantDate } from "./types";

export function daysInYear(months: CalendarMonth[]): number {
  return months.reduce((sum, m) => sum + m.days, 0);
}

export function daysBeforeMonth(months: CalendarMonth[], monthPosition: number): number {
  return months.filter((m) => m.position < monthPosition).reduce((sum, m) => sum + m.days, 0);
}

export function elapsedDays(
  year: number,
  monthPosition: number,
  day: number,
  months: CalendarMonth[]
): number {
  return (year - 1) * daysInYear(months) + daysBeforeMonth(months, monthPosition) + (day - 1);
}

export function weekdayIndexFor(
  year: number,
  monthPosition: number,
  day: number,
  months: CalendarMonth[],
  weekdayCount: number
): number {
  if (!weekdayCount) return 0;
  const e = elapsedDays(year, monthPosition, day, months);
  return ((e % weekdayCount) + weekdayCount) % weekdayCount;
}

export function formatInworldDate(
  year: number | null | undefined,
  month: number | null | undefined,
  day: number | null | undefined,
  months: CalendarMonth[],
  era: string
): string | null {
  if (year == null) return null;
  const monthName = month != null ? months.find((m) => m.position === month)?.name : undefined;
  const parts: string[] = [];
  if (day != null) parts.push(String(day));
  if (monthName) parts.push(monthName);
  parts.push(String(year));
  const base = parts.join(" ");
  return era ? `${base} ${era}` : base;
}

// "ГОД МЕСЯЦ ДЕНЬ" order, used for campaign calendar events.
export function formatEventDate(year: number, month: number, day: number, months: CalendarMonth[]): string {
  const monthName = months.find((m) => m.position === month)?.name ?? month;
  return `${year} ${monthName} ${day}`;
}

export function formatImportantDate(date: ImportantDate, months: CalendarMonth[]): string {
  const monthName = date.month != null ? months.find((m) => m.position === date.month)?.name : undefined;
  if (date.recurrence === "monthly") {
    return `${date.day}-е число (ежемесячно)`;
  }
  if (date.recurrence === "annual") {
    return `${date.day}${monthName ? ` ${monthName}` : ""} (ежегодно)`;
  }
  return `${date.day}${monthName ? ` ${monthName}` : ""}${date.year != null ? ` ${date.year}` : ""}`;
}
