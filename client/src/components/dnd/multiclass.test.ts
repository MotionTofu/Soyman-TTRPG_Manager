import { describe, expect, it } from "vitest";
import { multiclassPrereqUnmet, multiclassProfs } from "./multiclass";

const a = (str: number, dex: number, wis = 10) => ({ str, dex, con: 10, int: 10, wis, cha: 10 });

describe("multiclass", () => {
  it("prereq: или / и / мусор", () => {
    expect(multiclassPrereqUnmet("Сила 13 или Ловкость 13", a(8, 14))).toBe(false);
    expect(multiclassPrereqUnmet("Сила 13 или Ловкость 13", a(12, 12))).toBe(true);
    expect(multiclassPrereqUnmet("Ловкость 13 и Мудрость 13", a(8, 14, 12))).toBe(true);
    expect(multiclassPrereqUnmet("Ловкость 13 и Мудрость 13", a(8, 14, 13))).toBe(false);
    expect(multiclassPrereqUnmet("по договорённости", a(8, 8))).toBe(false);
  });
  it("profs: поле читается, нет поля — null", () => {
    expect(multiclassProfs({})).toBeNull();
    expect(
      multiclassProfs({ multiclass_profs: { armor: [{ id: 1, name: "Лёгкие доспехи" }], tools: [], skill_count: 1, skill_any: true, tool_choice: { count: 1, group: "Музыкальный инструмент" } } })
    ).toEqual({ armor: [{ id: 1, name: "Лёгкие доспехи" }], tools: [], skillCount: 1, skillAny: true, toolChoice: { count: 1, group: "Музыкальный инструмент" } });
  });
});
