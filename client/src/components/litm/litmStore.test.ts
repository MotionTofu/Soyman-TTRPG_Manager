import { describe, expect, it } from "vitest";
import type { CompendiumEntry } from "../../types";
import { filterStore, storeOf } from "./litmStore";

const entry = (id: number, kind: string, name: string, position: number, data: Record<string, unknown> = {}, description = "") =>
  ({ id, kind, name, name_original: name, parent_id: null, position, data, description }) as unknown as CompendiumEntry;
const it_ = (name: string, note = "", group?: string) => ({ name, nameEn: name, note, noteEn: "", ...(group ? { group } : {}) });

const book = storeOf([
  entry(9, "mechanic_group", "Награды", 11, { page: "B38", groups: [{ name: "Питомцы", nameEn: "Pets", items: [{ name: "лисёнок", nameEn: "fox cub" }] }] },
    "Награда — поворот истории.\n\n**Монеты.** Плата — статус.\n\n**Особые сокровища.** Сюжетной темой."),
  entry(3, "mechanic_backpack_category_item", "Монеты", 10, { category_key: "coin", items: [] }, "Денег не считают."),
  entry(2, "mechanic_backpack_category_item", "Помощь", 2, { category_key: "helpers", items: [it_("мул", "Упрямый, но храбрый")] }),
  entry(1, "mechanic_backpack_category_item", "Броня", 1, {
    category_key: "armor", subgroups: [{ name: "Лёгкая броня", text: "" }, { name: "Тяжёлая броня", text: "Мешает плыть." }],
    items: [it_("кольчуга", "Сотни колец", "Тяжёлая броня"), it_("стёганка", "", "Лёгкая броня")],
  }),
  entry(0, "mechanic_group", "Рюкзак", 0, { page: "A132" }, "Один тег на старте."),
]);

describe("Общая лавка LitM", () => {
  it("keeps book order, subgroups as declared, Coin and Rewards apart", () => {
    expect(book.intro?.name).toBe("Рюкзак");
    expect(book.categories.map((c) => c.entry.name)).toEqual(["Броня", "Помощь"]);
    expect(book.categories[0].subs.map((s) => [s.name, s.items.map((i) => i.name), s.text])).toEqual([
      ["Лёгкая броня", ["стёганка"], ""], ["Тяжёлая броня", ["кольчуга"], "Мешает плыть."],
    ]);
    expect(book.categories[1].subs).toEqual([{ name: "", nameEn: "", text: "", items: [{ name: "мул", nameEn: "мул", note: "Упрямый, но храбрый", noteEn: "" }] }]);
    expect(book.coin?.entry.id).toBe(3);
    expect(book.rewards?.lead).toEqual(["Награда — поворот истории."]);
    expect(book.rewards?.parts).toEqual([{ head: "Монеты", text: "Плата — статус." }, { head: "Особые сокровища", text: "Сюжетной темой." }]);
  });

  it("searches item names and notes, a matching category keeps all its items", () => {
    const s = filterStore(book, "храбр");
    expect(s.categories.map((c) => c.entry.name)).toEqual(["Помощь"]);
    expect(s.rewards?.groups).toEqual([]);
    expect(filterStore(book, "броня").categories[0].subs).toHaveLength(2);
    expect(filterStore(book, "лисен").rewards?.groups[0].items.map((i) => i.name)).toEqual(["лисёнок"]);
    expect(filterStore(book, "денег").coin?.entry.id).toBe(3);
  });
});
