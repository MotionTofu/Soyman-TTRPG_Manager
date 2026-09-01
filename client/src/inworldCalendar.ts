import type { CalendarMonth, CalendarWeekday, CustomRule, DatePrecision, ImportantDate } from "./types";

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

/**
 * Промежуток одной строкой: «10 → 13 Июнь 1492».
 *
 * Общий хвост не повторяется. Полная запись обеих дат подряд — это «10 Июнь
 * 1492 Летоисчисление Долин → 13 Июнь 1492 Летоисчисление Долин»: строка, из
 * которой глазом не выудить, что прошло три дня.
 */
export function formatInworldRange(
  from: { year: number | null; month: number | null; day: number | null },
  to: { year: number | null; month: number | null; day: number | null } | null,
  months: CalendarMonth[],
  era: string
): string | null {
  const head = formatInworldDate(from.year, from.month, from.day, months, era);
  if (head == null) return null;
  if (!to || to.year == null) return head;
  const tail = formatInworldDate(to.year, to.month, to.day, months, era);
  if (tail == null) return head;
  if (from.year === to.year && from.month === to.month && from.day != null && to.day != null) {
    return `${from.day} → ${tail}`;
  }
  return `${head} → ${tail}`;
}

// "ГОД МЕСЯЦ ДЕНЬ" order, used for campaign calendar events.
export function formatEventDate(year: number, month: number, day: number, months: CalendarMonth[]): string {
  const monthName = months.find((m) => m.position === month)?.name ?? month;
  return `${year} ${monthName} ${day}`;
}

export function formatCustomRule(rule: CustomRule, weekdays: CalendarWeekday[]): string {
  if (rule.kind === "every") {
    const n = rule.every_n ?? 1;
    const unit = rule.every_unit ?? "год";
    return `раз в ${n} ${pluralRu(n, unit)}`;
  }
  const ordinal = rule.ordinal ?? 1;
  const unit1 = rule.ordinal_unit ?? "понедельник";
  const unit2 = rule.in_unit ?? "месяц";
  const ordinalLabel = ordinalOrdinalRu(ordinal);
  return `каждый ${ordinalLabel} ${unit1} ${unit2.replace(/а$/, "а")}`;
}

function pluralRu(n: number, unit: string): string {
  const abs = Math.abs(n) % 100;
  const lastDigit = abs % 10;
  if (abs > 10 && abs < 20) return unit + (unit === "неделя" ? "ь" : unit === "день" ? "" : unit === "месяц" ? "ев" : unit === "год" ? "лет" : unit === "десятилетие" ? "ий" : unit === "столетие" ? "ий" : unit === "тысячелетие" ? "ий" : "");
  if (lastDigit === 1) return unit + (unit === "неделя" ? "" : unit === "день" ? "" : unit === "месяц" ? "" : unit === "год" ? "" : unit === "десятилетие" ? "" : unit === "столетие" ? "" : unit === "тысячелетие" ? "" : "");
  if (lastDigit >= 2 && lastDigit <= 4) return unit + (unit === "неделя" ? "и" : unit === "день" ? "я" : unit === "месяц" ? "а" : unit === "год" ? "а" : unit === "десятилетие" ? "ия" : unit === "столетие" ? "ия" : unit === "тысячелетие" ? "ия" : "");
  return unit + (unit === "неделя" ? "ь" : unit === "день" ? "" : unit === "месяц" ? "ев" : unit === "год" ? "лет" : unit === "десятилетие" ? "ий" : unit === "столетие" ? "ий" : unit === "тысячелетие" ? "ий" : "");
}

function ordinalOrdinalRu(n: number): string {
  const abs = Math.abs(n) % 100;
  const lastDigit = abs % 10;
  if (abs > 10 && abs < 20) return `${n}-й`;
  if (lastDigit === 1) return `${n}-й`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${n}-й`;
  return `${n}-й`;
}

const GENITIVE_MONTHS: Record<string, string> = {
  "январь": "января", "февраль": "февраля", "март": "марта", "апрель": "апреля",
  "май": "мая", "июнь": "июня", "июль": "июля", "август": "августа",
  "сентябрь": "сентября", "октябрь": "октября", "ноябрь": "ноября", "декабрь": "декабря",
};

function genitiveMonth(name: string): string {
  const low = name.toLowerCase();
  return GENITIVE_MONTHS[low] ?? name;
}

export function formatImportantDate(date: ImportantDate, months: CalendarMonth[], weekdays?: CalendarWeekday[]): string {
  const monthName = date.month != null ? months.find((m) => m.position === date.month)?.name : undefined;
  const monthGen = monthName ? genitiveMonth(monthName) : undefined;
  if (date.recurrence === "weekly") {
    const wd = weekdays?.find((w) => w.position === date.day);
    return wd ? `каждую ${wd.name.toLowerCase()} (еженедельно)` : `каждую неделю, ${date.day}-й день`;
  }
  if (date.recurrence === "monthly") {
    return `${date.day}-е число (ежемесячно)`;
  }
  if (date.recurrence === "annual") {
    return `${date.day} ${monthGen ?? "???"} (ежегодно)`;
  }
  if (date.recurrence === "custom" && date.custom_rule) {
    try {
      const rule = JSON.parse(date.custom_rule) as CustomRule;
      return formatCustomRule(rule, weekdays ?? []);
    } catch { /* fall through */ }
  }
  return `${date.day}${monthGen ? ` ${monthGen}` : ""}${date.year != null ? ` ${date.year}` : ""}`;
}

// Обратное к elapsedDays: номер дня от начала летоисчисления → дата.
// Нужно оси: перетаскивание события считает пиксели, а сохранять надо
// год/месяц/день.
export function dateFromElapsed(
  elapsed: number,
  months: CalendarMonth[]
): { year: number; month: number; day: number } {
  const perYear = daysInYear(months);
  if (perYear <= 0 || months.length === 0) return { year: 1, month: 1, day: 1 };
  // Годы считаются от первого, а не от нулевого: в мирах бывает год 1 и не
  // бывает нулевого, и «минус первый» год ломал бы сортировку.
  const year = Math.floor(elapsed / perYear) + 1;
  let rest = elapsed - (year - 1) * perYear;
  const ordered = [...months].sort((a, b) => a.position - b.position);
  for (const m of ordered) {
    if (rest < m.days) return { year, month: m.position, day: rest + 1 };
    rest -= m.days;
  }
  const last = ordered[ordered.length - 1];
  return { year, month: last.position, day: last.days };
}

// Точность даты — это то, до чего событие вообще определено. «1492-06-15,
// точность month» читается как «июнь 1492»: 15-е там лежит только ради
// сортировки, и показывать его значило бы обещать несуществующую точность.
export function formatByPrecision(
  year: number,
  month: number,
  day: number,
  precision: DatePrecision,
  months: CalendarMonth[],
  era: string
): string {
  const suffix = era ? ` ${era}` : "";
  if (precision === "century") {
    const from = Math.floor((year - 1) / 100) * 100 + 1;
    return `${from}–${from + 99}${suffix}`;
  }
  if (precision === "decade") {
    const from = Math.floor((year - 1) / 10) * 10 + 1;
    return `${from}–${from + 9}${suffix}`;
  }
  if (precision === "year") return `${year}${suffix}`;
  const monthName = months.find((m) => m.position === month)?.name ?? month;
  if (precision === "month") return `${monthName} ${year}${suffix}`;
  return `${day} ${monthName} ${year}${suffix}`;
}
