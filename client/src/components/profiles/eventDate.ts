import { formatByPrecision, genitiveMonth } from "../../inworldCalendar";
import type { CalendarMonth, DatePrecision } from "../../types";

export function formatProfileEventDate(year: number, month: number, day: number, precision: DatePrecision, months: CalendarMonth[], era: string) {
  const shortEra = era.trim().includes(" ") ? era.trim().split(/\s+/).map((word) => word[0]).join("").toLocaleUpperCase() : era;
  return formatByPrecision(year, month, day, precision,
    precision === "day" ? months.map((m) => ({ ...m, name: genitiveMonth(m.name) })) : months, shortEra);
}
