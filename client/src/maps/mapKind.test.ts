import { describe, expect, it } from "vitest";
import { OVERVIEW_PRESETS, cellLoreOf, formatMeters, mapKind, overviewScale, parseCellLore, TACTICAL_CELL } from "./mapTypes";
import { scaleMarks } from "./ScalePreview";
import { TOOL_GROUPS, toolLabel, toolsOf } from "./workspace/toolSets";

describe("три вида карт", () => {
  it("тактическая — locality, город — settlement, остальные масштабы обзорные", () => {
    expect(mapKind("locality")).toBe("tactical");
    expect(mapKind("settlement")).toBe("city");
    expect((["region", "country", "continent", "planet"] as const).map(mapKind)).toEqual(Array(4).fill("overview"));
    // В городе вместо комнаты квартал, дверей нет.
    expect(TOOL_GROUPS.city.flat()).toEqual(expect.arrayContaining(["shape", "wall", "road"]));
    expect(TOOL_GROUPS.city.flat()).not.toContain("door");
    expect(toolLabel("city", "shape")).toBe("Квартал");
    expect(toolLabel("tactical", "shape")).toBe("Комната");
    // Одна панель: комнаты и двери — только на тактической, пол по клеткам — способ «Поверхности», а не кнопка.
    expect(TOOL_GROUPS.tactical.flat()).toEqual(expect.arrayContaining(["shape", "door", "wall", "road", "liquid"]));
    expect(TOOL_GROUPS.overview.flat()).not.toContain("door");
    for (const kind of ["tactical", "overview"] as const) { expect(TOOL_GROUPS[kind].flat()).not.toContain("brush"); expect(toolsOf(kind)).toContain("brush"); }
  });
  it("обзорная пишет в базу ближайшую заготовку и никогда не locality и не settlement", () => {
    expect(overviewScale(2)).toBe("region");
    expect(overviewScale(7)).toBe("country");
    expect(overviewScale(0.001)).toBe("region");
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
    for (const metres of [1.5, 10, ...OVERVIEW_PRESETS.map((item) => item.km * 1000)]) {
      const marks = scaleMarks(metres);
      expect(marks.length).toBeGreaterThanOrEqual(2);
      expect(marks[0].cells).toBe(1);
    }
    // Фишка занимает ровно клетку: человек на тактической карте — одна клетка.
    expect(scaleMarks(1.5)).toEqual([{ name: "человек", cells: 1 }, { name: "лошадь", cells: 2 }, { name: "телега", cells: 3 }]);
  });
});
