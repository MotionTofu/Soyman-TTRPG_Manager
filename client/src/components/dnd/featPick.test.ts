import { describe, it, expect } from "vitest";
import { featPrereqProblem } from "./featPick";

const who = (over: Partial<Parameters<typeof featPrereqProblem>[1]> = {}) => ({
  level: 4,
  abilities: { str: 10, dex: 14, con: 12, int: 8, wis: 13, cha: 16 },
  profNames: ["Лёгкие доспехи"],
  casts: false,
  featNames: [],
  ...over,
});

describe("featPrereqProblem", () => {
  it("reads level in all spellings", () => {
    expect(featPrereqProblem("Уровень 4+", who({ level: 3 }))).toBe("с 4 уровня");
    expect(featPrereqProblem("4-й уровень и выше", who({ level: 3 }))).toBe("с 4 уровня");
    expect(featPrereqProblem("Уровень 19+", who())).toBe("с 19 уровня");
    expect(featPrereqProblem("Уровень 4+", who())).toBeNull();
  });
  it("checks one-of abilities 13+", () => {
    expect(featPrereqProblem("Уровень 4+, Сила или Ловкость 13+", who())).toBeNull();
    expect(featPrereqProblem("Уровень 4+, Интеллект 13+", who())).toBe("нужна Инт 13");
    expect(featPrereqProblem("Уровень 4+, Интеллект, Мудрость или Харизма 13+", who())).toBeNull();
  });
  it("checks armor proficiency and casting", () => {
    expect(featPrereqProblem("Уровень 4+, владение средними доспехами", who())).toBe("нужно владение: средние доспехи");
    expect(featPrereqProblem("Уровень 4+, владение лёгкими доспехами", who())).toBeNull();
    expect(featPrereqProblem("Уровень 4+, умение Использование заклинаний или Магия договора", who())).toBe("нужно умение колдовать");
  });
  it("matches a required feat regardless of word order", () => {
    expect(featPrereqProblem("4 уровень, черта Друг-фамильяр", who({ featNames: ["Фамильяр-друг"] }))).toBeNull();
    expect(featPrereqProblem("Уровень 4+, черта «Посвящённый в магию»", who())).toBe("нужна черта «Посвящённый в магию»");
  });
  it("does not block on what it cannot read", () => {
    expect(featPrereqProblem("Кампания в Эберроне, невозможно получить другую черту Драконьей метки", who())).toBeNull();
  });
});

import { applyFeatPick, featCtxFrom, featPickMissing, EMPTY_FEAT_PICK, spellCandidates } from "./featPick";
import { EMPTY_GRANTS, type SourceGrants } from "./dndGrants";
import { emptyDndCharacter } from "@shared/dnd/normalize";
import type { CompendiumEntry } from "../../types";

const featEntry = (id: number, name: string, data: Record<string, unknown> = {}) =>
  ({ id, name, kind: "feat", data, description: "" }) as unknown as CompendiumEntry;
const spell = (id: number, name: string, level: number, classes: number[]) =>
  ({ id, name, level, kind: "spell", data: { classes: classes.map((c) => ({ id: c })) } }) as unknown as CompendiumEntry;
const catalogs = (spellIndex: CompendiumEntry[] = []) => ({ spellIndex, tools: [], weapons: [], skills: [] });

describe("applyFeatPick", () => {
  it("Resilient: +1 and the save of the same ability, capped at 20", () => {
    const value = { ...emptyDndCharacter(), abilities: { str: 10, dex: 14, con: 20, int: 8, wis: 12, cha: 10 } };
    const g: SourceGrants = { ...EMPTY_GRANTS, abilityIncrease: { options: ["str", "dex", "con", "int", "wis", "cha"], amount: 1, max: 20 }, saveFromAbility: true };
    const entry = featEntry(5, "Устойчивый");
    const ctx = featCtxFrom(value, 2, entry.id);
    expect(featPickMissing(entry, g, EMPTY_FEAT_PICK, ctx)).toEqual(["+1 и спасбросок"]);
    const next = applyFeatPick(value, entry, g, { ...EMPTY_FEAT_PICK, ability: "wis" }, ctx, catalogs());
    expect(next.abilities.wis).toBe(13);
    expect(next.savingThrowProfs.wis).toBe(true);
    expect(next.feats).toEqual([{ name: "Устойчивый", description: "", entryId: 5, choices: { ability: "wis" } }]);
  });

  it("Keen Mind: a skill already known becomes expertise", () => {
    const value = { ...emptyDndCharacter(), skillProfs: { History: 1 } as Record<string, 0 | 1 | 2> };
    const g: SourceGrants = { ...EMPTY_GRANTS, skillOrExpertise: { count: 1, options: ["History", "Arcana"] } };
    const entry = featEntry(6, "Острый ум");
    const next = applyFeatPick(value, entry, g, { ...EMPTY_FEAT_PICK, skillOrExpertise: ["History"] }, featCtxFrom(value, 2, 6), catalogs());
    expect(next.skillProfs.History).toBe(2);
  });

  it("Magic Initiate: spells come from the chosen list, the 1st-level one casts free", () => {
    const value = emptyDndCharacter();
    const g: SourceGrants = {
      ...EMPTY_GRANTS,
      spellListChoice: [100, 200],
      spellAbilityChoice: true,
      spellChoices: [
        { count: 2, level: 0, classIds: [], schools: [], outsideLimit: true },
        { count: 1, level: 1, classIds: [], schools: [], outsideLimit: true, freeCast: true },
      ],
    };
    const entry = featEntry(7, "Посвящённый в магию");
    const index = [spell(1, "Свет", 0, [100]), spell(2, "Огненный снаряд", 0, [200]), spell(3, "Щит", 1, [200])];
    const ctx = featCtxFrom(value, 2, 7);
    expect(spellCandidates(index, g.spellChoices[0], [200]).map((e) => e.name)).toEqual(["Огненный снаряд"]);
    const pick = { ...EMPTY_FEAT_PICK, spellList: 200, spellAbility: "int" as const, spells: { 0: [2], 1: [3] } };
    const next = applyFeatPick(value, entry, g, pick, ctx, catalogs(index));
    expect(next.cantrips).toEqual([{ entryId: 2, name: "Огненный снаряд", prepared: 2, outsideLimit: true, ability: "int" }]);
    expect(next.spellsByLevel[0]).toEqual([{ entryId: 3, name: "Щит", prepared: 2, outsideLimit: true, ability: "int", freeCast: true }]);
    expect(next.feats[0].choices).toEqual({ spellList: 200, spellAbility: "int" });
    // Второй «Посвящённый» не берёт тот же список (Q5).
    expect(featCtxFrom(next, 2, 7).takenLists).toEqual([200]);
  });
});
