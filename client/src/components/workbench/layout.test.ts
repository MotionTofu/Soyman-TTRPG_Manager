import { describe, expect, it } from "vitest";
import { GAP, paginate, type LayoutItem } from "./layout";

const H = 1000;
/** Блок со строками по 25 px: разрез возможен после каждой строки. */
const text = (id: string, lines: number, width: "full" | "half" = "full"): LayoutItem => ({
  id, kind: "block", width, height: lines * 25, splittable: true,
  breaks: Array.from({ length: lines }, (_, i) => (i + 1) * 25),
});
const card = (id: string, height: number): LayoutItem => ({ id, kind: "block", width: "half", height, breaks: [height], splittable: false });
const shape = (pages: ReturnType<typeof paginate>["pages"]) => pages.map((p) => p.map((x) => `${x.ids.join("+")}:${x.from}-${x.to}${x.continued ? "c" : ""}`));

describe("workbench pagination", () => {
  it("flows a long fragment onto the next sheets, cutting only between lines, losing nothing", () => {
    const { pages } = paginate([text("a", 90)], H);
    expect(shape(pages)).toEqual([["a:0-1000"], ["a:1000-2000c"], ["a:2000-2250c"]]);
  });

  it("continues the next block under the tail of the previous one", () => {
    const { pages } = paginate([text("a", 10), text("b", 50)], H);
    // 250 занято, ещё GAP — остаётся 724: целых строк в нём 28 (700 px).
    expect(shape(pages)).toEqual([["a:0-250", "b:0-700"], ["b:700-1250c"]]);
    expect(250 + GAP + 700).toBeLessThanOrEqual(H);
  });

  it("does not leave a sliver of a block at the bottom of a sheet", () => {
    const { pages } = paginate([text("a", 38), text("b", 10)], H);
    // После 950 px места на одну строку нет (GAP съедает остаток) — блок целиком на следующем листе.
    expect(shape(pages)).toEqual([["a:0-950"], ["b:0-250"]]);
  });

  it("starts a new sheet on a page break, but not a blank one", () => {
    const { pages } = paginate([{ id: "x", kind: "break" }, text("a", 4), { id: "y", kind: "break" }, { id: "z", kind: "break" }, text("b", 4)], H);
    expect(shape(pages)).toEqual([["a:0-100"], ["b:0-100"]]);
  });

  it("pairs halves into rows and never splits a row", () => {
    const { pages } = paginate([card("c1", 300), card("c2", 420), card("c3", 200), text("t", 30)], H);
    expect(shape(pages)).toEqual([["c1+c2:0-420", "c3:0-200", "t:0-325"], ["t:325-750c"]]);
    expect(pages[0][0].half).toBe(true);
  });

  it("moves a row that does not fit to the next sheet whole", () => {
    const { pages } = paginate([text("a", 30), card("c1", 400), card("c2", 300)], H);
    expect(shape(pages)).toEqual([["a:0-750"], ["c1+c2:0-400"]]);
  });

  it("puts a half taller than a sheet in full width and flows it (В17)", () => {
    const tall: LayoutItem = { ...(text("h", 60, "half") as Extract<LayoutItem, { kind: "block" }>), full: { height: 750, breaks: [250, 500, 750] } };
    const { pages, forcedFull } = paginate([card("c1", 200), tall], H);
    expect(forcedFull).toEqual(new Set(["h"]));
    expect(shape(pages)).toEqual([["c1:0-200", "h:0-750"]]);
  });

  it("cuts a card taller than a whole sheet at the sheet edge rather than dropping it", () => {
    const { pages } = paginate([{ id: "big", kind: "block", width: "full", height: 1500, breaks: [1500], splittable: false }], H);
    expect(shape(pages)).toEqual([["big:0-1000"], ["big:1000-1500c"]]);
  });
});
