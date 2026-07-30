// Registry for the statblock visual theme system (see statblockThemes.css,
// ported from design_handoff_statblocks/statblocks.html). Independent from
// the app's own theme (themes.ts) — chosen per statblock, not globally.
export const STATBLOCK_THEMES: { id: string; label: string }[] = [
  { id: "color", label: "Гравюра (цвет)" },
  { id: "print", label: "Гравюра (ч/б, печать)" },
  { id: "cyberpunk", label: "Киберпанк" },
  { id: "steampunk", label: "Стимпанк" },
  { id: "noir", label: "Соевый Нуар" },
  { id: "anime", label: "Баблгам" },
  { id: "fey", label: "Фейский" },
  { id: "aberrant", label: "Аберрантный" },
  { id: "undead", label: "Андедовский" },
  { id: "rustic", label: "Rustic fantasy" },
  { id: "disney", label: "Блублускай" },
  { id: "comic", label: "Комиксовый" },
  { id: "barovia", label: "Баровия" },
  { id: "slavic", label: "Древнеславянский" },
];

// "color" (Гравюра) is the default — the base .sb-scope vars already are
// that theme, so no extra class needed.
export function statblockThemeClass(theme: string | null | undefined): string {
  return theme && theme !== "color" ? `theme-${theme}` : "";
}

export function statblockScopeClass(theme: string | null | undefined, density: string | null | undefined): string {
  return ["sb-scope", statblockThemeClass(theme), density === "compact" ? "density-compact" : ""]
    .filter(Boolean)
    .join(" ");
}
