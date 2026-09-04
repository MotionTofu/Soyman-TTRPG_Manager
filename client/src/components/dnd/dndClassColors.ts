import type { CompendiumEntry, DndClassEntry } from "../../types";

// Цвет класса — единственная краска на карте персонажа (гриллинг 2026-09-04,
// Q8/Q24). Тема «Соевый нуар» монохромна, акцент в ней равен чернилам, и
// поэтому цвет класса ничему не мешает: он не спорит с акцентом интерфейса,
// а занимает пустующее место. По дизайн-системе (§3.2) цвет занимает не
// больше 15% площади — здесь это боковые кромки рамки, картуш уровня, заливка
// хитов и активные пометки владений.
//
// Значение берётся из записи класса в справочнике (`data.color`), и только
// если его там нет — из таблицы ниже по имени. Порядок именно такой: у
// самодельного и импортированного класса своего цвета в таблице быть не
// может, а вписать его в запись владелец может всегда.

/** Нейтральный для класса, которого нет ни в записи, ни в таблице. */
export const NEUTRAL_CLASS_COLOR = "#4a4741";

// Тринадцать классов PHB 5.5 плюс Артефактор. Оттенки подобраны так, чтобы
// каждый читался на бумаге #e8e4da белым текстом поверх и был отличим от
// соседей по колоде: рядом на экране оказываются карты разных игроков.
const BY_NAME: Record<string, string> = {
  "варвар": "#8f1f16",
  "бард": "#8a2f6b",
  "воин": "#6b4a2a",
  "волшебник": "#2f4f9e",
  "друид": "#3f6b2a",
  "жрец": "#9a7a1e",
  "колдун": "#5b2f8a",
  "монах": "#1f7a72",
  "паладин": "#7a8794",
  "плут": "#3a3f45",
  "следопыт": "#5e6b2a",
  "рейнджер": "#5e6b2a",
  "чародей": "#c2410c",
  "изобретатель": "#a05a1e",
  "артефактор": "#a05a1e",
};

const HEX = /^#[0-9a-f]{6}$/i;

// Имя класса в живой базе редко бывает голым: импорт модуля кладёт рядом
// оригинал — «Воин [Fighter]», иногда «Воин (Fighter)». Ключ таблицы — то,
// что осталось до скобки. Без этого весь справочник PHB получал нейтральный
// цвет, и найдено это было не рассуждением, а первым же открытым чарником.
function classKey(className: string): string {
  return className
    .split(/[[(]/)[0]
    .trim()
    .toLowerCase();
}

/** Цвет одного класса: сначала запись справочника, потом таблица имён. */
export function classColor(entry: CompendiumEntry | undefined, className: string): string {
  const own = entry?.data?.color;
  if (typeof own === "string" && HEX.test(own.trim())) return own.trim();
  return BY_NAME[classKey(className)] ?? NEUTRAL_CLASS_COLOR;
}

// Мультикласс: цвет даёт класс с наибольшим уровнем, а не первый взятый.
// «С чего начал» — история, «где больше уровней» — кто ты сейчас. Градиент из
// двух цветов отвергнут: он красив ровно до третьего класса.
export function sheetClassColor(
  classes: DndClassEntry[],
  getEntry: (id: number | null | undefined) => CompendiumEntry | undefined
): string {
  let best: DndClassEntry | null = null;
  for (const c of classes) {
    if (!c.className?.trim()) continue;
    if (!best || (c.level || 0) > (best.level || 0)) best = c;
  }
  if (!best) return NEUTRAL_CLASS_COLOR;
  return classColor(getEntry(best.classId), best.className);
}

// Плашка цвета класса поверх бумаги требует светлого текста, а на светлом
// (Паладин) — тёмного. Одна формула на все случаи, чтобы не заводить второй
// список «у кого какой текст».
export function textOnClassColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l > 0.55 ? "#1c1c1c" : "#e8e4da";
}
