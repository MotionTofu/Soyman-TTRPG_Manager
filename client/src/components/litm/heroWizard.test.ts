// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { LitmThemeBook, LitmThemeKit, LitmTrope } from "./litmCompendium";
import {
  applyTrope,
  buildHero,
  emptyHero,
  fillChoice,
  reviewChecks,
  setPath,
  setThemeMode,
  stepReady,
  stepsFor,
  themeGaps,
  toggleTag,
  type HeroDraft,
  type WizardBook,
} from "./heroWizard";

const book = (enName: string, ruName: string, might: string): LitmThemeBook => ({
  id: enName.length,
  name: ruName,
  enName,
  ruName,
  data: { might, powerQuestions: ["A?", "B?", "C?"], weaknessQuestions: ["W?"], questIdeas: [], improvements: [{ name: "Улучшение", text: "текст" }] },
});
const kit = (id: number, name: string, en: string, themebookEn: string, might = "origin"): LitmThemeKit => ({
  id,
  name,
  nameEn: en,
  parentId: 1,
  themebookEn,
  bookEn: themebookEn,
  data: { might, powerTags: ["p1", "p2", "p3"], weaknessTags: ["w1", "w2"], quest: `Квест ${name}` },
});
const KITS = [
  kit(1, "Сплетница", "Rumormonger", "Personality"),
  kit(2, "Хозяйка усадьбы", "Homesteader", "Skill or Trade"),
  kit(3, "Наша деревня", "Our Village", "Devotion"),
  kit(4, "Отменная стряпуха", "Excellent Cook", "Prodigious Ability", "adventure"),
  kit(5, "Докучливая пикси", "Irksome Pixie", "Companion", "variable"),
];
const TROPE: LitmTrope = {
  id: 77,
  name: "Деревенская сплетница",
  data: {
    group: "Деревенские",
    blurb: "",
    themes_fixed: ["Personality", "Skill or Trade", "Devotion"],
    themes_choose_one: ["Companion", "Prodigious Ability"],
    backpack: ["припрятанное печенье", "компромат на (выберите)"],
    kits_fixed: [
      { name: "Сплетница", name_original: "Rumormonger", theme: "Personality" },
      { name: "Хозяйка усадьбы", name_original: "Homesteader", theme: "Skill or Trade" },
      { name: "Наша деревня", name_original: "Our Village", theme: "Devotion" },
    ],
    kits_choose: [
      { name: "Докучливая пикси", name_original: "Irksome Pixie", theme: "Companion" },
      { name: "Отменная стряпуха", name_original: "Excellent Cook", theme: "Prodigious Ability" },
    ],
  },
};
const BOOK: WizardBook = { tropes: [TROPE], kits: KITS, books: [book("Personality", "Личность", "origin"), book("Devotion", "Преданность", "origin"), book("Knowledge", "Знание", "adventure")] };

function quickHero(): HeroDraft {
  let d = applyTrope(setPath(emptyHero("Марфа", "Игрок"), "quick"), TROPE, 1, KITS);
  d = { ...d, themes: d.themes.map((t) => ({ ...t, power: ["p1", "p3"], weak: ["w2"] })), backpack: fillChoice("компромат на (выберите)", "старосту Ольху") };
  return d;
}

describe("визард героя LitM", () => {
  it("шаги идут по пути книги", () => {
    expect(stepsFor("quick").slice(0, 3)).toEqual(["path", "trope", "theme0"]);
    expect(stepsFor("detail").slice(0, 3)).toEqual(["path", "types", "theme0"]);
    expect(stepsFor("simple")).toEqual(["path", "theme0", "theme1", "theme2", "theme3", "backpack", "relations", "dossier", "review"]);
  });

  it("троп ставит четыре набора тропа, квест набора подставлен", () => {
    const d = applyTrope(setPath(emptyHero(), "quick"), TROPE, 1, KITS);
    expect(d.themes.map((t) => t.kitId)).toEqual([1, 2, 3, 4]);
    expect(d.themes[3].quest).toBe("Квест Отменная стряпуха");
    expect(stepReady(d, "trope", BOOK)).toBe(true);
  });

  it("из набора — ровно 2 силы и 1 слабость, лишний не выбирается", () => {
    expect(toggleTag(["a", "b"], "c", 2)).toEqual(["a", "b"]);
    expect(toggleTag(["a", "b"], "a", 2)).toEqual(["b"]);
    const d = applyTrope(setPath(emptyHero(), "quick"), TROPE, 0, KITS);
    expect(themeGaps(d.themes[0], BOOK)).toEqual(["теги силы 0 из 2", "тег слабости"]);
    expect(themeGaps({ ...d.themes[0], power: ["p1", "p2"], weak: ["w1"] }, BOOK)).toEqual([]);
  });

  it("анкета: первый вопрос обязателен, всего три ответа силы", () => {
    const t = setThemeMode({ ...applyTrope(emptyHero(), TROPE, 0, KITS).themes[0] }, "questions");
    expect(t.type).toBe("Personality");
    expect(themeGaps({ ...t, answers: { 1: "b", 2: "c", 3: "d" }, weakAnswers: { 0: "w" } }, BOOK)).toEqual(["ответ на первый вопрос"]);
    expect(themeGaps({ ...t, answers: { 0: "a", 2: "c", 5: "f" }, weakAnswers: { 0: "w" } }, BOOK)).toEqual([]);
  });

  it("лист: имя темы — тег-название, теги и квест, рюкзак с подставленным словом, отношения", () => {
    const heroes = [{ id: 15, name: "Воин" }, { id: 17, name: "Эльф" }];
    const d = { ...quickHero(), relations: { 15: "прикрывает мне спину" } };
    const out = buildHero(d, BOOK, heroes);
    expect(out.themes?.[3]).toMatchObject({ name: "Отменная стряпуха", power: "adventure", themeType: "Prodigious Ability", powerTags: ["p1", "p3"], weaknessTags: ["w2"] });
    expect(out.backpack).toEqual(["компромат на старосту Ольху"]);
    expect(out.relationships).toEqual([{ characterId: 15, name: "Воин", tag: "прикрывает мне спину" }]);
    const checks = reviewChecks(d, BOOK, heroes);
    expect(checks.filter((c) => !c.ok && c.block)).toEqual([]);
    expect(checks.find((c) => c.step === "relations")?.text).toBe("Отношения: не задан тег к Эльф");
  });

  it("смена пути сбрасывает темы чужого режима", () => {
    const d = setPath(quickHero(), "simple");
    expect(d.themes.every((t) => t.mode === "manual" && t.power.length === 0)).toBe(true);
    expect(reviewChecks(d, BOOK, []).find((c) => c.block && !c.ok)?.step).toBe("theme0");
  });
});
