// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { CompendiumEntry, LitMCharacterData } from "../../types";
import { normalizeCharacter } from "./LitMCharacterForm";
import { giveTreasure, treasureTheme, treasuresOf } from "./litmTreasury";

const entry = (id: number, name: string, position: number, data: Record<string, unknown>) =>
  ({ id, kind: "treasure", name, name_original: name, parent_id: null, position, data, description: "" }) as unknown as CompendiumEntry;

const [boots, favor] = treasuresOf([
  entry(2, "Милость лорда", 2, { type: "Влияние", typeEn: "Influence", powerTags: ["средства лорда", "почёт при дворе"], weakness: "враги лорда — мои враги", page: "B40" }),
  entry(1, "Сапоги болотника", 1, { type: "Реликвия", typeEn: "Relic", powerTags: ["хожу по трясине", "всегда чистые"], weakness: "не нырнуть в мутную воду" }),
]);

describe("Сокровищница LitM", () => {
  it("reads treasures in book order with power tags and weakness apart", () => {
    expect([boots.entry.name, boots.powerTags, boots.weakness, favor.typeEn]).toEqual(["Сапоги болотника", ["хожу по трясине", "всегда чистые"], "не нырнуть в мутную воду", "Influence"]);
  });

  it("gives a treasure as a story theme: first empty slot, then a new one, never twice", () => {
    const theme = treasureTheme({ ...boots, name: boots.entry.name });
    expect(theme).toMatchObject({ name: "Сапоги болотника", themeType: "Реликвия", powerTags: ["хожу по трясине", "всегда чистые"], weaknessTags: ["не нырнуть в мутную воду"] });
    const hero = normalizeCharacter({}) as LitMCharacterData;
    const once = { ...hero, ...giveTreasure(theme)(hero) } as LitMCharacterData;
    expect(once.storyThemes.map((t) => t.name)).toEqual(["Сапоги болотника"]);
    expect(giveTreasure(theme)(once)).toBeNull();
    const lord = treasureTheme({ ...favor, name: favor.entry.name });
    expect(giveTreasure(lord)(once)?.storyThemes?.map((t) => t.name)).toEqual(["Сапоги болотника", "Милость лорда"]);
  });
});
