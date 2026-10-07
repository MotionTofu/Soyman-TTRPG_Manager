import { describe, expect, it } from "vitest";
import { TILE, inRange, visibleTiles } from "./tiles";

describe("visibleTiles", () => {
  it("covers the screen from the world origin", () => {
    expect(visibleTiles(0, 0, TILE, TILE, 1)).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
    expect(visibleTiles(0, 0, TILE + 1, TILE * 2, 1)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
  it("follows the camera offset in both directions", () => {
    expect(visibleTiles(10, -10, TILE, TILE, 1)).toEqual({ x0: -1, y0: 0, x1: 0, y1: 1 });
    expect(visibleTiles(-TILE * 3, 0, TILE, TILE, 1)).toEqual({ x0: 3, y0: 0, x1: 3, y1: 0 });
  });
  it("counts tiles in device pixels", () => {
    // На экране с плотностью 2 плитка занимает половину стороны в CSS-пикселях.
    expect(visibleTiles(0, 0, TILE, TILE / 2, 2)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0 });
  });
});

describe("inRange", () => {
  it("keeps a ring of neighbours when asked", () => {
    const range = { x0: 0, y0: 0, x1: 1, y1: 1 };
    expect(inRange(range, 2, 0)).toBe(false);
    expect(inRange(range, 2, -1, 1)).toBe(true);
    expect(inRange(range, 3, 0, 1)).toBe(false);
  });
});
