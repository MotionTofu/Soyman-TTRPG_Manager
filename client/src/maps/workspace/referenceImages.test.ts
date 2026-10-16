import { describe, expect, it } from "vitest";
import type { ReferenceImage } from "@shared/maps/core";
import { dragReference, fitReference, fromLocal, pixelsPerCell, placeReference, referenceSize, widthForCells } from "./referenceImages";

const base: ReferenceImage = { id: "r", image: "0b7c1d9e-1111-4222-8333-944455556666", pixels: { w: 400, h: 200 }, position: { x: 10, y: 10 }, width: 8, rotation: 30, opacity: 1 };
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); };
const corner = (item: ReferenceImage, sx: number, sy: number) => { const { vw, vh } = referenceSize(item); return fromLocal(item, { x: sx * vw / 2, y: sy * vh / 2 }); };

describe("подложка: геометрия", () => {
  it("угол тянет картинку, противоположный угол стоит, пропорции те же", () => {
    const from = corner(base, 1, 1), to = { x: from.x + 3, y: from.y + 1 };
    const next = { ...base, ...dragReference(base, { kind: "corner", sx: 1, sy: 1 }, from, to, false) } as ReferenceImage;
    close(corner(next, -1, -1), corner(base, -1, -1));
    expect(next.width).toBeGreaterThan(base.width);
  });

  it("обрезка левого края не сдвигает остальную картинку", () => {
    const from = corner(base, -1, 0), to = fromLocal(base, { x: -base.width / 2 + 2, y: 0 });
    const next = { ...base, ...dragReference(base, { kind: "edge", side: "left" }, from, to, false) } as ReferenceImage;
    expect(next.crop?.x0).toBeCloseTo(0.25, 6);
    close(corner(next, 1, -1), corner(base, 1, -1));
    close(corner(next, 1, 1), corner(base, 1, 1));
  });

  it("поворот с Shift — шагом 15°", () => {
    const at = fromLocal(base, { x: 0, y: -5 }), to = fromLocal({ ...base, rotation: base.rotation + 20 }, { x: 0, y: -5 });
    expect(dragReference(base, { kind: "rotate" }, at, to, true).rotation).toBe(45);
  });

  it("вписывание в карту и точки на клетку", () => {
    const flat = { ...base, rotation: 0 }, bounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 };
    expect(fitReference(flat, bounds, "width")).toEqual({ width: 100, position: { x: 50, y: 40 } });
    expect(fitReference(flat, bounds, "height").width).toBeCloseTo(160, 6);
    expect(fitReference(flat, bounds, "whole").width).toBeCloseTo(100, 6);
    expect(pixelsPerCell(flat, 1)).toBe(50);
    expect(widthForCells({ ...flat, crop: { x0: 0.5, y0: 0, x1: 1, y1: 1 } }, 10, 1)).toBe(20);
  });

  it("первая картинка — целиком в карту, следующая — с тем же числом точек на клетку", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 };
    const first = placeReference("a", base.image, { w: 2000, h: 1000 }, bounds, { x: 5, y: 5 }, null);
    expect(first.width).toBe(100);
    const second = placeReference("b", base.image, { w: 500, h: 500 }, bounds, { x: 5, y: 5 }, first);
    expect(pixelsPerCell(second, 1)).toBeCloseTo(pixelsPerCell(first, 1), 6);
    expect(second.position).toEqual({ x: 5, y: 5 });
  });
});
