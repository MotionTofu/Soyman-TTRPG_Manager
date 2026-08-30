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

interface DndPrefs {
  skillSortMode: DndSkillSortMode;
  abilityPrimary: DndAbilityPrimary;
}

const DEFAULTS: DndPrefs = {
  skillSortMode: "ability",
  // По умолчанию модификатор: в 5.5 бросают им, а само значение нужно для
  // переноски и захвата — то есть заметно реже.
  abilityPrimary: "mod",
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
