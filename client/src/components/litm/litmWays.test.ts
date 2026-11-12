// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { CompendiumEntry } from "../../types";
import { findKit, kitKey, kitsOf, tropeThemes, type LitmThemeBook, type LitmTrope } from "./litmCompendium";
import { waysInTropes, waysOf } from "./litmWays";

const entry = (id: number, kind: string, name: string, name_original: string, parent: number | null, position: number, data: Record<string, unknown> = {}) =>
  ({ id, kind, name, name_original, parent_id: parent, position, data, description: "", section_id: 1 }) as unknown as CompendiumEntry;

const kit = (might: string, q: string) => ({ might, powerTags: ["оберег"], weaknessTags: ["вдали от людей"], quest: q });

// анкеты «Ремесло» и «Магия», путь «Ведьмовство» — наборы в разных разделах
const entries = [
  entry(1, "themebook", "Ремесло", "Skill or Trade", 100, 0, { might: "origin" }),
  entry(2, "themebook", "Магия", "Magic", 101, 0, { might: "variable", improvements: [{ name: "Знаток магии", text: "Спросить подробность." }] }),
  entry(11, "theme_kit", "Кузнец", "Blacksmith", 1, 0, kit("origin", "Ковать")),
  entry(12, "theme_kit", "Охотник", "Hunter", 1, 1, kit("origin", "Выследить")),
  entry(20, "magic_way", "Ведьмовство", "Witchcraft", null, 1, { page: "A227–A229", variant: { head: "Вариант", text: "Сильнее" }, ingredients: [{ name: "Обряд для вида", nameEn: "Ritual As Flavor" }] }),
  entry(21, "theme_kit", "Деревенская ведьма", "Hedge Witch", 20, 0, kit("origin", "Оставьте меня")),
  entry(22, "theme_kit", "Пылающий призыватель («огонь»)", "Blazing Invoker (“fire”)", 20, 1, kit("adventure", "Гори")),
  entry(30, "mechanic_group", "Основы магии", "Fundamentals of Magic", null, 0, { sections: [{ head: "Магические действия", text: "…" }] }),
];
const kits = kitsOf(entries);
const books: LitmThemeBook[] = [
  { id: 1, name: "Ремесло", ruName: "Ремесло", enName: "Skill or Trade", data: { might: "origin", powerQuestions: [], weaknessQuestions: [], questIdeas: [], improvements: [] } },
  { id: 2, name: "Магия", ruName: "Магия", enName: "Magic", data: { might: "variable", powerQuestions: [], weaknessQuestions: [], questIdeas: [], improvements: [{ name: "Знаток магии", text: "Спросить подробность." }] } },
];
const trope = {
  id: 9, name: "Деревенская сплетница",
  data: {
    group: "Деревенские", blurb: "", backpack: [],
    themes_fixed: ["Skill or Trade"], themes_choose_one: ["Witchcraft"],
    kits_fixed: [{ name: "Охотник", name_original: "Hunter", theme: "Skill or Trade" }],
    kits_choose: [{ name: "Знахарка", name_original: "Hedge Witch", theme: "Witchcraft" }],
  },
} as LitmTrope;

describe("наборы тропов и пути магии LitM", () => {
  it("knows the theme of a kit from its parent, ways give the Magic themebook", () => {
    expect(kits.map((k) => [k.name, k.themebookEn, k.bookEn])).toEqual([
      ["Кузнец", "Skill or Trade", "Skill or Trade"], ["Охотник", "Skill or Trade", "Skill or Trade"],
      ["Деревенская ведьма", "Witchcraft", "Magic"], ["Пылающий призыватель («огонь»)", "Witchcraft", "Magic"],
    ]);
  });

  it("finds the trope's own kit by its book name, not the first kit of the theme", () => {
    expect(findKit(kits, "Skill or Trade", trope.data.kits_fixed![0])?.name).toBe("Охотник");
    expect(findKit(kits, "Skill or Trade")?.name).toBe("Кузнец");
    expect(findKit(kits, "Witchcraft", { name: "", name_original: "Blazing Invoker", theme: "Witchcraft" })?.id).toBe(22);
    expect(kitKey("Giant’s Gauntlet")).toBe(kitKey("Giant's Gauntlet"));
  });

  it("builds hero themes: way kit becomes a Magic theme with the kit's might", () => {
    const [skill, magic] = tropeThemes(trope, 0, kits, books);
    expect(skill).toMatchObject({ name: "Охотник [Skill or Trade]", themeType: "Skill or Trade", power: "origin", quest: "Выследить" });
    expect(magic).toMatchObject({ name: "Деревенская ведьма [Witchcraft]", themeType: "Magic", power: "origin", quest: "Оставьте меня" });
    expect(magic.specialImprovements).toEqual([{ text: "Знаток магии — Спросить подробность.", active: false }]);
    expect(tropeThemes(trope, null, kits, books)).toHaveLength(1);
  });

  it("reads ways and chapters in book order and finds tropes using a way", () => {
    const book = waysOf(entries);
    expect(book.chapters.map((c) => c.entry.name)).toEqual(["Основы магии"]);
    const [witch] = book.ways;
    expect(witch.kits.map((k) => k.id)).toEqual([21, 22]);
    expect(witch.variant?.head).toBe("Вариант");
    expect(witch.ingredients).toEqual([{ name: "Обряд для вида", nameEn: "Ritual As Flavor" }]);
    const tropeEntry = entry(9, "trope", "Деревенская сплетница", "Village Gossip", null, 0, trope.data as unknown as Record<string, unknown>);
    expect(waysInTropes(witch, [tropeEntry], kitKey)).toEqual(["Деревенская сплетница"]);
  });
});
