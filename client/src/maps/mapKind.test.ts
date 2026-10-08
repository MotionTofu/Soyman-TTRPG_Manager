import { describe, expect, it } from "vitest";
import { OVERVIEW_PRESETS, cellLoreOf, formatMeters, mapKind, overviewScale, parseCellLore, TACTICAL_CELL } from "./mapTypes";
import { scaleMarks } from "./ScalePreview";
import { setsOf } from "./workspace/toolSets";

describe("два вида карт", () => {
  it("тактическая — только locality, остальные масштабы обзорные", () => {
    expect(mapKind("locality")).toBe("tactical");
    expect((["settlement", "region", "country", "continent", "planet"] as const).map(mapKind)).toEqual(Array(5).fill("overview"));
    expect(setsOf("locality")).toEqual(["dungeon", "locality"]);
    expect(setsOf("region")).toEqual(["world"]);
  });
  it("обзорная пишет в базу ближайшую заготовку и никогда не locality", () => {
    expect(overviewScale(2)).toBe("region");
    expect(overviewScale(7)).toBe("country");
    expect(overviewScale(0.001)).toBe("settlement");
    expect(overviewScale(9000)).toBe("planet");
  });
  it("подпись клетки читается обратно линейкой", () => {
    expect(parseCellLore(TACTICAL_CELL)).toBe(1.5);
    expect(formatMeters(1.5)).toBe("1,5 м");
    expect(parseCellLore(cellLoreOf(0.02))).toBe(20);
    expect(parseCellLore(cellLoreOf(2.5))).toBe(2500);
  });
  it("в предпросмотре на любой заготовке есть знакомые вещи", () => {
    // Клетка — единица измерения: у каждой заготовки самая мелкая вещь занимает ровно клетку.
    for (const metres of [1.5, ...OVERVIEW_PRESETS.map((item) => item.km * 1000)]) {
      const marks = scaleMarks(metres);
      expect(marks.length).toBeGreaterThanOrEqual(2);
      expect(marks[0].cells).toBe(1);
    }
    // Фишка занимает ровно клетку: человек на тактической карте — одна клетка.
    expect(scaleMarks(1.5)).toEqual([{ name: "человек", cells: 1 }, { name: "лошадь", cells: 2 }, { name: "телега", cells: 3 }]);
  });
});
