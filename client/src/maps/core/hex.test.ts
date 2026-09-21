// Hex regression (§52 ТЗ): конкретные числа hex-геометрии + переиспользование grid.ts.
// Ожидаемые значения посчитаны вручную из формулы odd-q pointy-top:
// center(x,y) = (√3·(x + 0.5·(y&1)), 1.5·y).

import { describe, expect, it } from "vitest";
import { cellCenter, cellCorners, worldBounds } from "../grid";

const SQRT3 = Math.sqrt(3);

describe("hex math regression", () => {
  it("cellCenter: конкретные значения", () => {
    expect(cellCenter("hex", 0, 0)).toEqual({ cx: 0, cy: 0 });
    const c10 = cellCenter("hex", 1, 0);
    expect(c10.cx).toBeCloseTo(SQRT3, 12);
    expect(c10.cy).toBe(0);
    // Нечётный ряд сдвинут на полшага.
    const c01 = cellCenter("hex", 0, 1);
    expect(c01.cx).toBeCloseTo(SQRT3 / 2, 12);
    expect(c01.cy).toBeCloseTo(1.5, 12);
    const c23 = cellCenter("hex", 2, 3);
    expect(c23.cx).toBeCloseTo(SQRT3 * 2.5, 12);
    expect(c23.cy).toBeCloseTo(4.5, 12);
  });

  it("cellCorners: 6 вершин pointy-top вокруг центра", () => {
    const pts = cellCorners("hex", 0, 0);
    expect(pts).toHaveLength(6);
    // Вершина -90°: (0,-1).
    expect(pts[0].px).toBeCloseTo(0, 12);
    expect(pts[0].py).toBeCloseTo(-1, 12);
  });

  it("square cellCenter unchanged", () => {
    expect(cellCenter("square", 2, 3)).toEqual({ cx: 2.5, cy: 3.5 });
  });

  it("worldBounds hex имеет запас — миграция использует точный bbox, не его", () => {
    const wb = worldBounds("hex", 6, 6);
    // worldBounds даёт поля -1/+1 (для камеры); точный bbox углов уже покрыт
    // golden/migrate тестами. Здесь фиксируем, что они различаются осознанно.
    expect(wb.minX).toBe(-1);
    expect(wb.minY).toBe(-1);
  });
});
