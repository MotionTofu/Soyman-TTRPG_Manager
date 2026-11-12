/** Сокровищница LitM (доска Litm-Treasury): особые сокровища — сюжетные темы героя (кн. II, с. B38, B40). */
import type { CompendiumEntry, LitMCharacterData, LitMThemeCard } from "../../types";
import { emptyTheme } from "./ThemeCard";

export interface Treasure { entry: CompendiumEntry; type: string; typeEn: string; powerTags: string[]; weakness: string; page: string }

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s !== "") : []);

/** Сокровища в порядке книги. */
export function treasuresOf(entries: CompendiumEntry[]): Treasure[] {
  return entries.filter((e) => e.kind === "treasure")
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((e) => ({
      entry: e, type: str(e.data?.type), typeEn: str(e.data?.typeEn),
      powerTags: strs(e.data?.powerTags), weakness: str(e.data?.weakness), page: str(e.data?.page),
    }));
}

/** Сокровище сюжетной темой: имя — главный тег, два тега силы, слабость. */
export function treasureTheme(t: { name: string; type: string; powerTags: string[]; weakness: string }): LitMThemeCard {
  return { ...emptyTheme(), name: t.name, themeType: t.type, powerTags: t.powerTags, weaknessTags: t.weakness ? [t.weakness] : [] };
}

const blank = (t: LitMThemeCard) => !t.name && !t.themeType && !t.power && !t.powerTags.length && !t.weaknessTags.length;

/** Правка листа «дать сокровище»: в первую пустую сюжетную тему или новой; если такое уже есть — ничего. */
export function giveTreasure(theme: LitMThemeCard) {
  return (d: LitMCharacterData): Partial<LitMCharacterData> | null => {
    if (d.storyThemes.some((t) => t.name === theme.name)) return null;
    const at = d.storyThemes.findIndex(blank);
    return { storyThemes: at >= 0 ? d.storyThemes.map((t, i) => (i === at ? theme : t)) : [...d.storyThemes, theme] };
  };
}
