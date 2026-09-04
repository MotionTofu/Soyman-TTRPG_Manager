// Display preferences for D&D 5.5 statblocks — same pattern as
// thumbnailStyles.ts (localStorage, JSON-merged with defaults).
export type DndSkillSortMode = "ability" | "alphabet";

export const DND_SKILL_SORT_OPTIONS: { key: DndSkillSortMode; label: string }[] = [
  { key: "ability", label: "По характеристикам" },
  { key: "alphabet", label: "По алфавиту" },
];

// Какое число стоит на лицевой грани кости характеристики — модификатор
// («+3») или само значение («16»). Настройка сквозная: статблок существа,
// карточка существа и лист персонажа читают одну и ту же. Довод тот же, что
// у тумблера дуотона (design_revision.md §3) — «я читаю модификаторы» это
// убеждение Мастера, а не свойство места, и «+3» в статблоке при «16» в
// карточке было бы расхождением, а не гибкостью.
export type DndAbilityPrimary = "mod" | "score";

export const DND_ABILITY_PRIMARY_OPTIONS: { key: DndAbilityPrimary; label: string }[] = [
  { key: "mod", label: "Модификатор (+3)" },
  { key: "score", label: "Значение (16)" },
];

// В чём показывать расстояния. За столом с полем считают клетками, без поля
// — футами; в книге написаны футы, и лист их и хранит. Настройка только про
// показ: хранимое значение не трогается, иначе перевод накапливал бы ошибку
// при каждом переключении.
export type DndDistanceUnit = "feet" | "cells";

export const DND_DISTANCE_UNIT_OPTIONS: { key: DndDistanceUnit; label: string }[] = [
  { key: "feet", label: "Футы (30 фт.)" },
  { key: "cells", label: "Клетки (6 кл.)" },
];

/** Клетка — 5 футов. Делится нацело почти всегда; остаток показывается
 *  дробью с половиной, потому что 2,5 фута — это половина клетки, а не
 *  «примерно клетка». */
export const FEET_PER_CELL = 5;

/** Расстояние в выбранной единице. Половина клетки показывается дробью:
 *  «2,5 фута» — это половина клетки, а не «примерно клетка». */
export function formatDistance(feet: number, unit: DndDistanceUnit): string {
  if (unit !== "cells") return `${feet} фт.`;
  const cells = feet / FEET_PER_CELL;
  const rounded = Math.round(cells * 2) / 2;
  return `${String(rounded).replace(".", ",")} кл.`;
}

interface DndPrefs {
  skillSortMode: DndSkillSortMode;
  abilityPrimary: DndAbilityPrimary;
  // Показывать во вкладке «Заклинания» только подготовленное. В отличие от
  // двух настроек выше, эта переключается не во «Внешнем виде», а прямо у
  // списка заклинаний: утром её выключают, чтобы подготовиться, в бою
  // включают, чтобы не листать книгу. Хранится здесь только чтобы пережить
  // перезагрузку — за столом переключать её заново каждый раз незачем.
  spellsPreparedOnly: boolean;
  distanceUnit: DndDistanceUnit;
}

const DEFAULTS: DndPrefs = {
  skillSortMode: "ability",
  // По умолчанию видно всё: на свежем листе звёздочки не расставлены, и
  // включённый фильтр показал бы пустоту вместо книги заклинаний.
  spellsPreparedOnly: false,
  // По умолчанию модификатор: в 5.5 бросают им, а само значение нужно для
  // переноски и захвата — то есть заметно реже.
  abilityPrimary: "mod",
  // По умолчанию футы: так написано в книге и так лежит в листах.
  distanceUnit: "feet",
};

const STORAGE_KEY = "rpgManagerDndPrefs";
const CHANGE_EVENT = "dnd-prefs-changed";

export function loadDndPrefs(): DndPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      if (raw.includes("__proto__") || raw.includes("constructor")) throw new Error("polluted");
      const parsed = JSON.parse(raw) as Partial<DndPrefs>;
      const out: DndPrefs = { ...DEFAULTS };
      if (parsed.skillSortMode === "ability" || parsed.skillSortMode === "alphabet") out.skillSortMode = parsed.skillSortMode;
      if (parsed.abilityPrimary === "mod" || parsed.abilityPrimary === "score") out.abilityPrimary = parsed.abilityPrimary;
      if (typeof parsed.spellsPreparedOnly === "boolean") out.spellsPreparedOnly = parsed.spellsPreparedOnly;
      if (parsed.distanceUnit === "feet" || parsed.distanceUnit === "cells") out.distanceUnit = parsed.distanceUnit;
      return out;
    }
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  return { ...DEFAULTS };
}

export function saveDndPrefs(prefs: DndPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  // Кости характеристик нарисованы в нескольких местах разом (статблок,
  // карточка существа, лист персонажа), и переключение должно доходить до
  // всех открытых, а не только до перерисованных заново.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export { CHANGE_EVENT as DND_PREFS_EVENT };
