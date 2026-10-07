import { describe, expect, it } from "vitest";
import { inRange, tileSide, visibleTiles } from "./tiles";

const TILE = tileSide(1);

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
    // На экране с плотностью 2 плитка вдвое больше в пикселях устройства — в CSS-пикселях та же.
    expect(tileSide(2)).toBe(TILE * 2);
    expect(visibleTiles(0, 0, TILE * 2, TILE, 2)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0 });
    // Дробная плотность: плитка остаётся целой в пикселях устройства.
    expect(visibleTiles(0, 0, 256 / 1.25 + 1, 10, 1.25)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0 });
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
