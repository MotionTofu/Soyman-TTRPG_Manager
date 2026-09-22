import { describe, it, expect } from "vitest";
import {
  getLevelUpBaseSignature,
  isCompatibleLevelUpDraft,
  sanitizeLevelUpStep,
  type LevelUpDraft,
  type LevelUpDraftIdentity,
} from "./dndLevelUpDraft";
import type { DndCharacterData } from "../../types";

// Resumable level-up drafts (C2): what survives a reload, what invalidates,
// what never invalidates (runtime fields).

const character = (overrides: Record<string, unknown> = {}): DndCharacterData =>
  ({
    systemId: 1,
    classes: [{ classId: 11, className: "Воин", level: 3, subclassId: null }],
    abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
    feats: [],
    classFeatures: [{ entryId: 101 }],
    speciesFeatures: [],
    hpLump: 20,
    hpMiscPerLevel: 0,
    hitPointMax: "30",
    hitPointsCurrent: "30",
    notes: "",
    ...overrides,
  }) as unknown as DndCharacterData;

const identity: LevelUpDraftIdentity = { characterId: 7, characterUid: "uid-7", catalogKey: "slice-7" };

function draftFor(base: ReturnType<typeof getLevelUpBaseSignature>): LevelUpDraft {
  return {
    version: 1,
    identity: { ...identity },
    base,
    targetLevel: base.totalLevel + 1,
    updatedAt: "2026-09-22T00:00:00.000Z",
    state: {
      clsIdx: 0, step: "Новое", hpMode: "average", rolled: null, manualTotal: "",
      miscText: "0", subclassId: null, featId: null, asiPrimary: null, asiSecondary: null,
    },
  };
}

describe("level-up draft compatibility", () => {
  it("round-trips selections for the same character", () => {
    const c = character();
    const base = getLevelUpBaseSignature(c);
    const draft = draftFor(base);
    expect(isCompatibleLevelUpDraft(draft, base, identity)).toBe(true);
    expect(draft.state.step).toBe("Новое");
    expect(draft.targetLevel).toBe(4);
  });

  it("runtime edits never invalidate", () => {
    const base = getLevelUpBaseSignature(character());
    const played = character({
      hitPointsCurrent: "4",
      hitPointMax: "30",
      notes: "едва жив",
      resourceUsed: { rage: 2 },
      deathSaveSuccesses: 2,
    });
    expect(getLevelUpBaseSignature(played)).toEqual(base);
    expect(isCompatibleLevelUpDraft(draftFor(base), getLevelUpBaseSignature(played), identity)).toBe(true);
  });

  it("progression changes invalidate", () => {
    const base = getLevelUpBaseSignature(character());
    const stale = (c: DndCharacterData) =>
      isCompatibleLevelUpDraft(draftFor(base), getLevelUpBaseSignature(c), identity);
    // Level taken elsewhere.
    expect(stale(character({ classes: [{ classId: 11, className: "Воин", level: 4, subclassId: null }] }))).toBe(false);
    // Subclass changed.
    expect(stale(character({ classes: [{ classId: 11, className: "Воин", level: 3, subclassId: 55 }] }))).toBe(false);
    // Feat acquired.
    expect(stale(character({ feats: [{ name: "Крепкий" }] }))).toBe(false);
    // ASI applied.
    expect(
      stale(character({ abilities: { str: 18, dex: 10, con: 14, int: 10, wis: 10, cha: 10 } }))
    ).toBe(false);
    // Feature granted.
    expect(stale(character({ classFeatures: [{ entryId: 101 }, { entryId: 102 }] }))).toBe(false);
    // HP model tweak.
    expect(stale(character({ hpMiscPerLevel: 1 }))).toBe(false);
  });

  it("identity must match, with one-way UID tolerance", () => {
    const base = getLevelUpBaseSignature(character());
    const draft = draftFor(base);
    expect(isCompatibleLevelUpDraft(draft, base, { ...identity, characterId: 8 })).toBe(false);
    expect(isCompatibleLevelUpDraft(draft, base, { ...identity, catalogKey: "other" })).toBe(false);
    expect(isCompatibleLevelUpDraft(draft, base, { ...identity, characterUid: "other" })).toBe(false);
    // Draft stamped before the character ever had a UID still applies.
    const preUid = { ...draft, identity: { ...identity, characterUid: null } };
    expect(isCompatibleLevelUpDraft(preUid, base, identity)).toBe(true);
    expect(isCompatibleLevelUpDraft(null, base, identity)).toBe(false);
    expect(isCompatibleLevelUpDraft(draft, base, null)).toBe(false);
  });

  it("resume never opens a vanished step", () => {
    const steps = ["Хиты", "Новое", "Обзор"];
    expect(sanitizeLevelUpStep("Новое", steps)).toBe("Новое");
    expect(sanitizeLevelUpStep("Черта", steps)).toBe("Хиты");
    expect(sanitizeLevelUpStep(null, steps)).toBe("Хиты");
  });
});
