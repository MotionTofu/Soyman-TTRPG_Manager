// Прогрессия класса по уровням — структура вместо markdown-строки.
//
// Раньше вся таблица класса («Уровень | Бонус владения | Ячейки 1 | 2 | …»)
// хранилась одним куском текста. Читать её человеку удобно, а приложению —
// никак: ячейки заклинаний на листе вбивались руками, а пулы ресурсов
// (Ярость, Кость вдохновения, Очки колдовства) пришлось зашить кодом в
// dndResources.ts с проверкой имени класса строкой. Добавить класс без
// правки исходников было нельзя — при том, что весь компендиум построен на
// обратном принципе.
//
// Модель намеренно остаётся таблицей: произвольные колонки с ячейками-
// строками, плюс роль у тех колонок, по которым приложение умеет считать.
// Так и редактор остаётся сеткой (привычной по книге правил), и импортёру
// есть что заполнять, и колонки вроде «Урон ярости» не требуют новых полей.

export type ProgressionRole =
  | "" // декоративная колонка — показываем, но не считаем по ней
  | "level"
  | "prof_bonus"
  | "features"
  | "cantrips"
  | "prepared"
  | "slot1"
  | "slot2"
  | "slot3"
  | "slot4"
  | "slot5"
  | "slot6"
  | "slot7"
  | "slot8"
  | "slot9"
  // Одна колонка со всеми ячейками сразу: «1-4, 2-3, 3-2» (Бард,
  // Артефактор). Тот же смысл, что и девять slotN, просто иначе записано.
  | "slots_packed"
  // Договор магии Колдуна: N ячеек одного круга, и круг растёт отдельно.
  // Держим отдельно от обычных ячеек — они и восстанавливаются иначе, и
  // складывать их с обычными нельзя.
  | "pact_slots"
  | "pact_level"
  // Расходуемый пул: Ярость, Очки чародейства, Проведение божественности.
  // Получает дорожку «израсходовано» на листе.
  | "resource"
  // Показатель, который просто растёт по уровням и ничего не расходует:
  // «Урон ярости +2», «Кость вдохновения к8», «Коварная атака 1к6». Виден
  // на листе, но тратить его нечем.
  | "stat";

export interface ProgressionColumn {
  key: string; // стабильный ключ ячейки в строке
  label: string; // то, что видно в шапке
  role: ProgressionRole;
}

export interface ClassProgression {
  columns: ProgressionColumn[];
  rows: Record<string, string>[];
}

export const PROGRESSION_ROLE_LABELS: Record<ProgressionRole, string> = {
  "": "— просто колонка —",
  level: "Уровень",
  prof_bonus: "Бонус владения",
  features: "Умения",
  cantrips: "Заговоры",
  prepared: "Подготовленные заклинания",
  slot1: "Ячейки 1 круга",
  slot2: "Ячейки 2 круга",
  slot3: "Ячейки 3 круга",
  slot4: "Ячейки 4 круга",
  slot5: "Ячейки 5 круга",
  slot6: "Ячейки 6 круга",
  slot7: "Ячейки 7 круга",
  slot8: "Ячейки 8 круга",
  slot9: "Ячейки 9 круга",
  slots_packed: "Ячейки одной строкой («1-4, 2-3»)",
  pact_slots: "Договор магии: число ячеек",
  pact_level: "Договор магии: круг ячеек",
  resource: "Расходуемый ресурс",
  stat: "Показатель по уровню",
};

export const PROGRESSION_ROLE_ORDER: ProgressionRole[] = [
  "",
  "level",
  "prof_bonus",
  "features",
  "cantrips",
  "prepared",
  "resource",
  "stat",
  "slots_packed",
  "pact_slots",
  "pact_level",
  "slot1",
  "slot2",
  "slot3",
  "slot4",
  "slot5",
  "slot6",
  "slot7",
  "slot8",
  "slot9",
];

export const EMPTY_PROGRESSION: ClassProgression = { columns: [], rows: [] };

function cell(row: Record<string, string>, columns: ProgressionColumn[], role: ProgressionRole): string {
  const col = columns.find((c) => c.role === role);
  return col ? (row[col.key] ?? "").trim() : "";
}

// «-», «—» и пустая ячейка в книге правил значат одно и то же: на этом
// уровне ячеек нет.
function num(raw: string): number {
  const n = parseInt(raw.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function progressionRowForLevel(
  progression: ClassProgression | undefined,
  level: number
): Record<string, string> | null {
  if (!progression || progression.rows.length === 0) return null;
  const levelCol = progression.columns.find((c) => c.role === "level");
  if (!levelCol) return progression.rows[level - 1] ?? null;
  return progression.rows.find((r) => num(r[levelCol.key] ?? "") === level) ?? null;
}

// «**1**-4, **2**-3, **3**-2» → [4,3,2,0,0,0,0,0,0]. Жирная разметка стоит
// на номере круга, поэтому снимается до разбора.
export function parsePackedSlots(raw: string): number[] {
  const slots = Array(9).fill(0);
  for (const part of raw.replace(/\*+/g, "").split(",")) {
    const m = /(\d)\s*[-–—]\s*(\d+)/.exec(part.trim());
    if (!m) continue;
    const circle = Number(m[1]);
    if (circle >= 1 && circle <= 9) slots[circle - 1] = Number(m[2]);
  }
  return slots;
}

// Ячейки заклинаний 1–9 круга на данном уровне класса. null, если у класса
// ячеек нет вовсе (Варвар, Плут, Воин) — это не то же самое, что девять
// нулей у заклинателя на 1 уровне.
export function spellSlotsAtLevel(progression: ClassProgression | undefined, level: number): number[] | null {
  if (!progression) return null;
  const row = progressionRowForLevel(progression, level);
  if (!row) return null;
  const packed = cell(row, progression.columns, "slots_packed");
  if (packed) return parsePackedSlots(packed);
  if (!progression.columns.some((c) => /^slot\d$/.test(c.role))) return null;
  return Array.from({ length: 9 }, (_, i) => num(cell(row, progression.columns, `slot${i + 1}` as ProgressionRole)));
}

// Договор магии — отдельная дорожка: сколько ячеек и какого круга.
export function pactSlotsAtLevel(
  progression: ClassProgression | undefined,
  level: number
): { count: number; circle: number } | null {
  if (!progression) return null;
  const row = progressionRowForLevel(progression, level);
  if (!row) return null;
  const count = num(cell(row, progression.columns, "pact_slots"));
  const circle = num(cell(row, progression.columns, "pact_level"));
  return count > 0 && circle > 0 ? { count, circle } : null;
}

export function cantripsAtLevel(progression: ClassProgression | undefined, level: number): number | null {
  if (!progression) return null;
  const row = progressionRowForLevel(progression, level);
  if (!row) return null;
  const raw = cell(row, progression.columns, "cantrips");
  return raw ? num(raw) : null;
}

export function preparedAtLevel(progression: ClassProgression | undefined, level: number): number | null {
  if (!progression) return null;
  const row = progressionRowForLevel(progression, level);
  if (!row) return null;
  const raw = cell(row, progression.columns, "prepared");
  return raw ? num(raw) : null;
}

// Колонки заданной роли с их значением на данном уровне — то, ради чего
// dndResources.ts перестаёт быть списком классов в коде.
export function columnsAtLevel(
  progression: ClassProgression | undefined,
  level: number,
  role: ProgressionRole
): { key: string; label: string; value: string }[] {
  if (!progression) return [];
  const row = progressionRowForLevel(progression, level);
  if (!row) return [];
  return progression.columns
    .filter((c) => c.role === role)
    .map((c) => ({ key: c.key, label: c.label, value: (row[c.key] ?? "").trim() }))
    .filter((r) => r.value && r.value !== "-" && r.value !== "—");
}

export function resourcesAtLevel(progression: ClassProgression | undefined, level: number) {
  return columnsAtLevel(progression, level, "resource");
}

export function statsAtLevel(progression: ClassProgression | undefined, level: number) {
  return columnsAtLevel(progression, level, "stat");
}

// ——— разбор markdown-таблицы ———

// Заголовки в книге записаны по-разному («Подготовл. заклинания» против
// «Подготовленные заклинания»), поэтому роль угадывается по началу строки
// после нормализации, а не точным равенством.
// Проверяется сверху вниз, поэтому частные заголовки стоят раньше общих:
// «Уровень ячеек» Колдуна иначе перехватывается правилом «Уровень», а
// «Ячейки заклинаний на уровень заклинаний» — правилом «Ячейки заклинаний».
const ROLE_BY_HEADER: [RegExp, ProgressionRole][] = [
  [/^ячейки\s+заклинаний\s+на\s+уровень/i, "slots_packed"],
  [/^ячейки\s+заклинаний$/i, "pact_slots"],
  [/^уровень\s+ячеек/i, "pact_level"],
  [/^уровень/i, "level"],
  [/^бонус\s+владения/i, "prof_bonus"],
  [/^(классовые\s+)?умени|^особенности/i, "features"],
  [/^заговор/i, "cantrips"],
  [/^(подготовл|известн).*заклинани/i, "prepared"],
];

function normalizeHeader(raw: string): string {
  return raw.replace(/\*+/g, "").trim();
}

// Колонки ячеек в книге озаглавлены «Ячейки 1 | 2 | 3 | …»: только у первой
// есть слово, дальше идут голые номера. Поэтому разбор — с состоянием: как
// только встретили «Ячейки N», последующие числовые заголовки продолжают
// нумерацию.
export function parseProgressionTable(markdown: string): ClassProgression {
  const lines = (markdown || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  if (lines.length < 2) return EMPTY_PROGRESSION;

  const split = (line: string): string[] =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const headers = split(lines[0]).map(normalizeHeader);
  // Вторая строка markdown-таблицы — разделитель из дефисов.
  const bodyLines = lines.slice(1).filter((l) => !/^\|[\s|:-]+\|?$/.test(l));

  let slotCounter = 0;
  const columns: ProgressionColumn[] = headers.map((label, i) => {
    const key = `c${i}`;
    const slotMatch = /^ячейки\s*(\d)/i.exec(label);
    if (slotMatch) {
      slotCounter = Number(slotMatch[1]);
      return { key, label, role: `slot${slotCounter}` as ProgressionRole };
    }
    if (slotCounter > 0 && /^\d$/.test(label)) {
      slotCounter = Number(label);
      return { key, label: `Ячейки ${label}`, role: `slot${slotCounter}` as ProgressionRole };
    }
    for (const [re, role] of ROLE_BY_HEADER) {
      if (re.test(label)) return { key, label, role };
    }
    // Всё остальное — то, что у класса своё: Ярость, Урон ярости, Кость
    // вдохновения, Очки колдовства. Это ресурсы, а не украшение.
    return { key, label, role: label ? "resource" : "" };
  });

  const rows = bodyLines.map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    columns.forEach((c, i) => {
      row[c.key] = cells[i] ?? "";
    });
    return row;
  });

  return { columns, rows };
}
