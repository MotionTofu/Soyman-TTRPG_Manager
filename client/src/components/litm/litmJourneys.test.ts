import { describe, expect, it } from "vitest";
import type { CompendiumEntry } from "../../types";
import { journeysOf, toggleStep } from "./litmJourneys";

const entry = (id: number, name: string, parent: number | null, position: number, data: Record<string, unknown> = {}) =>
  ({ id, kind: parent ? "mechanic_item" : "mechanic_group", name, name_original: name, parent_id: parent, position, data, description: "" }) as unknown as CompendiumEntry;
const v = (name: string, blocksPath = false) => ({ name, nameEn: name, threat: "*скользкий лёд*", consequences: ["Упали (*замёрз-2*)."], blocksPath });

const groups = journeysOf([
  entry(30, "Общие дорожные виньетки", null, 4, { page: "B200", groups: [{ name: "Случайные встречи", intro: "", page: "B200", vignettes: [v("Картограф")] }] }),
  entry(11, "Тёмный лес", 10, 1, { journeyKindRu: "Местность", tags: ["тени повсюду"], consequences: ["Заблудились (*заблудился-3*)."], vignettes: [v("Мшистая поляна"), v("Замёрзший ручей", true)], page: "B144" }),
  entry(12, "Замкнутая деревушка", 10, 0, { journeyKindRu: "Местность", vignettes: [] }),
  entry(10, "Местности", null, 1),
  entry(1, "Как устроено путешествие", null, 0, { page: "B108" }),
]);

describe("Путешествия LitM", () => {
  it("keeps groups and journeys in book order with vignettes and general groups", () => {
    expect(groups.map((g) => g.entry.name)).toEqual(["Как устроено путешествие", "Местности", "Общие дорожные виньетки"]);
    const [hamlet, forest] = groups[1].journeys;
    expect([hamlet.entry.name, forest.entry.name, forest.kind, forest.tags]).toEqual(["Замкнутая деревушка", "Тёмный лес", "Местность", ["тени повсюду"]]);
    expect(forest.vignettes.map((x) => [x.name, x.blocksPath])).toEqual([["Мшистая поляна", false], ["Замёрзший ручей", true]]);
    expect(groups[2].vignetteGroups[0].vignettes[0].name).toBe("Картограф");
  });

  it("picks steps in order up to the step count, unpicks on second click", () => {
    expect(toggleStep([], 3, 2)).toEqual([3]);
    expect(toggleStep([3, 0], 5, 2)).toEqual([3, 0]);
    expect(toggleStep([3, 0], 3, 2)).toEqual([0]);
  });
});
