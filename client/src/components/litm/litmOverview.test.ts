// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { CompendiumEntry } from "../../types";
import { bookUnits } from "./litmOverview";

let id = 0;
const e = (kind: string, parent: number | null = null, data: Record<string, unknown> = {}) =>
  ({ id: ++id, kind, name: `${kind} ${id}`, name_original: "", parent_id: parent, position: id, data, description: "" }) as unknown as CompendiumEntry;

describe("Обзор LitM: состав в единицах книги", () => {
  it("counts themes with kits, tropes with groups, ways with kits", () => {
    expect(bookUnits("themes", [e("themebook"), e("themebook"), e("theme_kit", 1), e("theme_kit", 1), e("theme_kit", 2), e("mechanic_group")])).toBe("2 темы · 3 набора");
    expect(bookUnits("tropes", [e("trope", null, { group: "Деревенские" }), e("trope", null, { group: "Деревенские" }), e("trope", null, { group: "Странники" })])).toBe("3 тропа · 2 группы");
    const way = e("magic_way");
    expect(bookUnits("ways", [way, e("theme_kit", way.id), e("mechanic_group")])).toBe("1 путь · 1 набор");
  });

  it("tells book challenges, add-ons and the GM's own apart", () => {
    const rows = [e("monster", null, { location: "Тёмный лес" }), e("monster", null, { location: "Тёмный лес", addon: true }), e("monster", null, { location: "Свои" }), e("monster")];
    expect(bookUnits("challenges", rows)).toBe("1 профиль · 1 надстройка · 2 своих");
  });

  it("counts store categories with Coin and reward examples", () => {
    const rows = [
      e("mechanic_backpack_category_item", null, { category_key: "armor", items: [] }),
      e("mechanic_backpack_category_item", null, { category_key: "coin", items: [] }),
      e("mechanic_group", null, { groups: [{ name: "Питомцы", items: [{ name: "лисёнок" }, { name: "сова" }] }] }),
    ];
    expect(bookUnits("store", rows)).toBe("2 категории · 2 награды");
  });
});
