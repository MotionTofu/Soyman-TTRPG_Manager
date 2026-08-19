// Заготовки календаря, предлагаемые при создании сеттинга.
//
// Пустой календарь — плохая точка старта: чтобы в сеттинге заработали даты,
// нужно завести месяцы и дни недели руками, а до тех пор хроника мира не
// показывает ничего осмысленного. Две готовые системы покрывают почти все
// случаи, а третья («собственная») строится из двух чисел.
//
// Эра вынесена под отдельный флаг намеренно: григорианский календарь сплошь и
// рядом используют там, где до рождества Христова никому нет дела, и навязывать
// «н. э.» такому сеттингу неправильно.

import { db } from "../db/db";

export interface CalendarPreset {
  key: string;
  label: string;
  hint: string;
  months: { name: string; days: number }[];
  weekdays: string[];
  /** Предлагается галочкой, а не ставится молча. */
  era?: { name: string; start_year: number };
}

const GREGORIAN: CalendarPreset = {
  key: "gregorian",
  label: "Григорианский",
  hint: "12 месяцев, семидневная неделя — привычный земной календарь.",
  months: [
    { name: "Январь", days: 31 },
    { name: "Февраль", days: 28 },
    { name: "Март", days: 31 },
    { name: "Апрель", days: 30 },
    { name: "Май", days: 31 },
    { name: "Июнь", days: 30 },
    { name: "Июль", days: 31 },
    { name: "Август", days: 31 },
    { name: "Сентябрь", days: 30 },
    { name: "Октябрь", days: 31 },
    { name: "Ноябрь", days: 30 },
    { name: "Декабрь", days: 31 },
  ],
  weekdays: [
    "Понедельник",
    "Вторник",
    "Среда",
    "Четверг",
    "Пятница",
    "Суббота",
    "Воскресенье",
  ],
  era: { name: "н. э.", start_year: 1 },
};

// Календарь Гарундата: двенадцать месяцев по тридцать дней и пять праздников
// между ними. Праздники заведены отдельными «месяцами» в один день — своей
// сущности для них в модели нет, а так они честно занимают своё место в году
// и попадают в даты.
const HARPTOS: CalendarPreset = {
  key: "harptos",
  label: "Фаэрунский (Календарь Гарундата)",
  hint: "12 месяцев по 30 дней, между ними 5 праздников, десятидневка.",
  months: [
    { name: "Молот", days: 30 },
    { name: "Праздник Зимы", days: 1 },
    { name: "Альтуриак", days: 30 },
    { name: "Чэс", days: 30 },
    { name: "Тарсак", days: 30 },
    { name: "Праздник Трав", days: 1 },
    { name: "Мирталь", days: 30 },
    { name: "Киторн", days: 30 },
    { name: "Флеймрул", days: 30 },
    { name: "Летнее Солнцестояние", days: 1 },
    { name: "Элеасис", days: 30 },
    { name: "Элейнт", days: 30 },
    { name: "Высокий Пир", days: 1 },
    { name: "Марпенот", days: 30 },
    { name: "Уктар", days: 30 },
    { name: "Пир Луны", days: 1 },
    { name: "Найтэл", days: 30 },
  ],
  weekdays: ["Первый день", "Второй день", "Третий день", "Четвёртый день", "Пятый день",
    "Шестой день", "Седьмой день", "Восьмой день", "Девятый день", "Десятый день"],
  era: { name: "ДР", start_year: 1 },
};

export const CALENDAR_PRESETS: CalendarPreset[] = [GREGORIAN, HARPTOS];

/**
 * Собственный календарь из двух чисел: сколько месяцев в году и сколько дней
 * в неделе. Длина месяца одна на всех — этого хватает, чтобы дата читалась
 * числом, а подправить отдельные месяцы можно в редакторе календаря.
 */
export function customPreset(
  months: number,
  daysPerMonth: number,
  weekdays: number
): CalendarPreset {
  const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
  const m = clamp(months, 1, 100);
  const d = clamp(daysPerMonth, 1, 200);
  const w = clamp(weekdays, 1, 100);
  return {
    key: "custom",
    label: "Собственный",
    hint: `${m} месяцев по ${d} дней, неделя из ${w} дней.`,
    months: Array.from({ length: m }, (_, i) => ({ name: `Месяц ${i + 1}`, days: d })),
    weekdays: Array.from({ length: w }, (_, i) => `День ${i + 1}`),
  };
}

/**
 * Раскладывает заготовку в календарь сеттинга. Ничего не перезаписывает: если
 * месяцы уже заведены, значит календарём занимались, и лезть туда нельзя.
 */
export function applyCalendarPreset(
  settingId: number,
  preset: CalendarPreset,
  withEra: boolean
): void {
  const existing = db
    .prepare("SELECT COUNT(*) n FROM setting_calendar_months WHERE setting_id = ?")
    .get(settingId) as { n: number };
  if (existing.n > 0) return;

  const insertMonth = db.prepare(
    "INSERT INTO setting_calendar_months (setting_id, position, name, days) VALUES (?, ?, ?, ?)"
  );
  const insertWeekday = db.prepare(
    "INSERT INTO setting_calendar_weekdays (setting_id, position, name) VALUES (?, ?, ?)"
  );
  const insertEra = db.prepare(
    "INSERT INTO setting_calendar_eras (setting_id, name, start_year) VALUES (?, ?, ?)"
  );
  const run = db.transaction(() => {
    preset.months.forEach((m, i) => insertMonth.run(settingId, i, m.name, m.days));
    preset.weekdays.forEach((w, i) => insertWeekday.run(settingId, i, w));
    if (withEra && preset.era) {
      insertEra.run(settingId, preset.era.name, preset.era.start_year);
      db.prepare("UPDATE settings SET calendar_era = ? WHERE id = ?").run(preset.era.name, settingId);
    }
  });
  run();
}

/** Заготовка по имени плюс сборка собственной — то, что зовёт маршрут создания. */
export function resolvePreset(input: {
  preset?: string;
  months?: number;
  daysPerMonth?: number;
  weekdays?: number;
}): CalendarPreset | null {
  if (!input.preset || input.preset === "none") return null;
  if (input.preset === "custom") {
    return customPreset(input.months ?? 12, input.daysPerMonth ?? 30, input.weekdays ?? 7);
  }
  return CALENDAR_PRESETS.find((p) => p.key === input.preset) ?? null;
}
