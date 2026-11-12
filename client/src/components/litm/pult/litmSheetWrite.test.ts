// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizeCharacter } from "../LitMCharacterForm";
import { addRelationship, expireBackpack, recoverFellowshipTag, reflectOn, relatedIds, restHero, scratchKey } from "./litmSheetWrite";

const hero = normalizeCharacter({
  backpack: ["ключ от кладовой", "моток шёлка"],
  statuses: [{ name: "напуган", marks: [2] }, { name: "устал", marks: [3] }],
  themes: [{ name: "Кузнец", powerTags: ["молот", "горн"], scratchedTags: ["молот", "горн"], improve: 2 }],
  fellowshipTheme: { name: "Один за всех", powerTags: ["плечом к плечу"], scratchedTags: ["плечом к плечу"] },
});

describe("привал пишет в лист героя (A179–A181)", () => {
  it("рюкзак: истекают только отмеченные теги", () => {
    expect(expireBackpack(["моток шёлка"])(hero)).toEqual({ backpack: ["ключ от кладовой"] });
    expect(expireBackpack(["чужой тег"])(hero)).toBeNull();
  });

  it("отдых: снятые галочки остаются в листе", () => {
    const p = restHero(["напуган"], [scratchKey("themes", 0, "молот")])(hero)!;
    expect(p.statuses).toEqual([{ name: "устал", marks: [3] }]);
    expect(p.themes![0].scratchedTags).toEqual(["горн"]);
    expect(restHero([], [])(hero)).toBeNull();
  });

  it("размышление: +1 Рост до трёх, в передышке — «улучшение ждёт»", () => {
    expect(reflectOn("themes:0", false)(hero).themes![0].improve).toBe(3);
    expect(reflectOn("themes:0", false)({ ...hero, themes: [{ ...hero.themes[0], improve: 3 }] }).themes![0].improve).toBe(3);
    const s = reflectOn("fellowshipTheme", true)(hero).fellowshipTheme!;
    expect(s.improvementPending).toBe(true);
    expect(s.improve).toBe(0);
  });

  it("время Содружества: тег возвращается, отношения копятся по одному на героя", () => {
    expect(recoverFellowshipTag("плечом к плечу")(hero).fellowshipTheme!.scratchedTags).toEqual([]);
    const one = { ...hero, ...addRelationship({ id: 16, name: "Детектив" }, "прикрою спину")(hero) };
    const two = { ...one, ...addRelationship({ id: 17, name: "Эльф" }, "должник")(one) };
    expect(two.relationships!.map((r) => r.tag)).toEqual(["прикрою спину", "должник"]);
    expect(relatedIds({ ...two, companionCharacterType: "character", companionCharacterId: 18 })).toEqual([16, 17, 18]);
    expect(normalizeCharacter(JSON.parse(JSON.stringify(two))).relationships).toEqual(two.relationships);
  });
});
