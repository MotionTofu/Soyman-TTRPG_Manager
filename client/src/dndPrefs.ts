// Display preference for the D&D 5.5 "Навыки" statblock tab — same pattern
// as thumbnailStyles.ts (localStorage, JSON-merged with defaults).
export type DndSkillSortMode = "ability" | "alphabet";

export const DND_SKILL_SORT_OPTIONS: { key: DndSkillSortMode; label: string }[] = [
  { key: "ability", label: "По характеристикам" },
  { key: "alphabet", label: "По алфавиту" },
];

interface DndPrefs {
  skillSortMode: DndSkillSortMode;
}

const DEFAULTS: DndPrefs = {
  skillSortMode: "ability",
};

const STORAGE_KEY = "rpgManagerDndPrefs";

export function loadDndPrefs(): DndPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveDndPrefs(prefs: DndPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
