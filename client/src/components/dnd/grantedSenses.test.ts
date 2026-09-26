import { describe, expect, it } from "vitest";
import type { CompendiumEntry, DndCharacterData } from "../../types";
import { withGrantedSenses } from "./dndFeatures";

// Чувства от вида, черт и умений класса; `stack` — «если уже есть, +N»
// («Теневой взор», «Искусства тени»), 2026-09-26.
const entries: Record<number, { data: Record<string, unknown> }> = {
  1: { data: { senses: [{ name: "Тёмное зрение", distance: "120" }] } }, // дварф
  2: { data: { senses: [{ name: "Тёмное зрение", distance: "60", stack: true }] } }, // Теневой взор
  3: { data: { senses: [{ name: "Слепое зрение", distance: "10" }] } }, // Сила тени (часть)
  4: { data: { senses: [{ name: "Дьявольское зрение", distance: "120" }] } }, // воззвание
};
const get = (id: number | null | undefined) => (id != null ? (entries[id] as unknown as CompendiumEntry) : undefined);
const sheet = (raceId: number | null, classFeatureIds: number[], specialIds: number[] = []) =>
  ({
    raceId,
    sensesList: [],
    feats: [],
    specialAbilities: specialIds.map((entryId) => ({ entryId, name: "" })),
    classFeatures: classFeatureIds.map((entryId) => ({ entryId, name: "" })),
  }) as unknown as DndCharacterData;

describe("withGrantedSenses", () => {
  it("прибавляет stack к тёмному зрению вида", () => {
    expect(withGrantedSenses(sheet(1, [2]), get).sensesList).toEqual([{ name: "Тёмное зрение", distance: "180" }]);
  });
  it("без своего тёмного зрения stack даёт базовую дальность", () => {
    expect(withGrantedSenses(sheet(null, [2]), get).sensesList).toEqual([{ name: "Тёмное зрение", distance: "60" }]);
  });
  it("читает чувства умений класса", () => {
    expect(withGrantedSenses(sheet(null, [3]), get).sensesList).toEqual([{ name: "Слепое зрение", distance: "10" }]);
  });
  it("воззвание — отдельной строкой рядом с тёмным зрением", () => {
    expect(withGrantedSenses(sheet(1, [], [4]), get).sensesList).toEqual([
      { name: "Тёмное зрение", distance: "120" },
      { name: "Дьявольское зрение", distance: "120" },
    ]);
  });
});
