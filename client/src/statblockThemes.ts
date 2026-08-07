// Registry for the statblock visual theme system (see statblockThemes.css).
// Independent from the app's own theme (themes.ts) — chosen per statblock,
// not globally.
export const STATBLOCK_THEMES: { id: string; label: string }[] = [
  { id: "zine", label: "Зин" },
  { id: "noir", label: "Соевый Нуар" },
  { id: "aberrant", label: "Аберрантный" },
];

// "zine" is the default — the base .sb-scope vars already are that theme.
// It still gets its own class (theme-zine) so zine-only CSS can target it
// without leaking onto every other theme that also falls back to the
// unscoped .sb-section rule.
export function statblockThemeClass(theme: string | null | undefined): string {
  return `theme-${theme || "zine"}`;
}

export function statblockScopeClass(theme: string | null | undefined, density: string | null | undefined): string {
  return ["sb-scope", statblockThemeClass(theme), density === "compact" ? "density-compact" : ""]
    .filter(Boolean)
    .join(" ");
}
