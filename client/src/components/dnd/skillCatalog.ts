import type { DndAbilityKey } from "../../types";

/**
 * Восемнадцать навыков D&D 5.5 — встроенный список листа.
 *
 * Зачем он вообще нужен, раз навыки лежат в Справочнике. Во-первых, за столом
 * лист обязан показать навыки, даже когда сервер лёг, система не выбрана или
 * компендиум не загрузился, — справочник эти имена уточняет, но не заменяет
 * (гриллинг 2026-09-04). Во-вторых, привязка навыка к характеристике — это
 * правило системы, а не перевод: «Скрытность от Ловкости» не меняется между
 * переводами и переизданиями, и ехать через данные, которые мастер может
 * править, ей незачем.
 *
 * Ключ владения в данных листа — `original`, английское имя. Не `id` записи
 * (модули каталога ставятся с новыми id, и лист с чужой машины потерял бы все
 * владения) и не русское имя (переименовали навык — сломались все листы).
 *
 * Серверный двойник — `server/src/db/dndSkillNames.ts`: он теми же именами
 * заполняет `name_original`, `data.ability` и алиасы записей справочника.
 * Общего разделяемого модуля между `client/` и `server/` в проекте нет,
 * поэтому списка два; правки вносить в оба.
 */
export interface SkillDef {
  /** Ключ владения в данных листа. */
  original: string;
  /** Имя, пока справочник не загрузился (и он же — ожидаемое имя записи). */
  name: string;
  ability: DndAbilityKey;
  /** Известные написания из переводов и старых записей. */
  aliases: string[];
}

export const SKILL_CATALOG: SkillDef[] = [
  { original: "Athletics", name: "Атлетика", ability: "str", aliases: [] },
  { original: "Acrobatics", name: "Акробатика", ability: "dex", aliases: [] },
  { original: "Sleight of Hand", name: "Ловкость рук", ability: "dex", aliases: [] },
  { original: "Stealth", name: "Скрытность", ability: "dex", aliases: [] },
  {
    original: "Investigation",
    name: "Анализ/расследование",
    ability: "int",
    aliases: ["Анализ", "Расследование"],
  },
  { original: "History", name: "История", ability: "int", aliases: [] },
  {
    original: "Arcana",
    name: "Арканная магия",
    ability: "int",
    aliases: ["Аркана", "Магия", "Тайная магия"],
  },
  { original: "Nature", name: "Природа", ability: "int", aliases: [] },
  { original: "Religion", name: "Религия", ability: "int", aliases: [] },
  {
    original: "Perception",
    name: "Внимание/восприятие",
    ability: "wis",
    aliases: ["Внимательность", "Восприятие"],
  },
  { original: "Survival", name: "Выживание", ability: "wis", aliases: [] },
  { original: "Medicine", name: "Медицина", ability: "wis", aliases: [] },
  { original: "Insight", name: "Проницательность", ability: "wis", aliases: [] },
  {
    original: "Animal Handling",
    name: "Уход за животными",
    ability: "wis",
    aliases: ["Обращение с животными", "Дрессировка"],
  },
  { original: "Performance", name: "Выступление", ability: "cha", aliases: [] },
  { original: "Intimidation", name: "Запугивание", ability: "cha", aliases: [] },
  { original: "Deception", name: "Обман", ability: "cha", aliases: [] },
  { original: "Persuasion", name: "Убеждение", ability: "cha", aliases: [] },
];

/**
 * Всё, по чему навык узнаётся во встроенном списке: оригинал, имя и алиасы —
 * без регистра и лишних пробелов. Регистр снимается не для красоты: импорт
 * пишет «Внимание/Восприятие» там, где справочник пишет «внимание/восприятие»
 * (та же беда уже ловилась в статблоке существа, DndCreatureForm.tsx).
 */
const BUILTIN_BY_KEY = new Map<string, SkillDef>();
for (const def of SKILL_CATALOG) {
  for (const key of [def.original, def.name, ...def.aliases]) {
    BUILTIN_BY_KEY.set(key.trim().toLowerCase(), def);
  }
}

export function normalizeSkillKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Сводит любое известное написание навыка к ключу (`original`).
 *
 * Второй аргумент — соответствия из справочника: имена и алиасы, которые
 * владелец добавил сам. Их знает только загруженный компендиум, поэтому
 * функция работает и без него: встроенные семь алиасов покрывают всё, что
 * есть в базе сегодня, и `normalizeDndCharacter` сводит по ним синхронно, в
 * момент разбора JSON.
 *
 * Возвращает `null`, если имя не сводится ни к чему: такое владение лист
 * показывает отдельной строкой с пометкой, а не выбрасывает — молча терять
 * данные и есть та беда, из-за которой всё это затевалось.
 */
export function resolveSkillOriginal(
  raw: string,
  fromCompendium?: Map<string, string>
): string | null {
  const key = normalizeSkillKey(raw);
  if (!key) return null;
  const builtin = BUILTIN_BY_KEY.get(key);
  if (builtin) return builtin.original;
  return fromCompendium?.get(key) ?? null;
}

export function skillByOriginal(original: string): SkillDef | undefined {
  return SKILL_CATALOG.find((s) => s.original === original);
}
