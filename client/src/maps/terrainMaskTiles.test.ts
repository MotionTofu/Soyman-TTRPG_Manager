import { describe, expect, it } from "vitest";
import { maskSampleCode, terrainEdgeTiles, terrainMaskTiles } from "./terrainMaskTiles";
import { buildTerrainMaskRaster } from "./terrainMaskRaster";
import type { RenderTerrainView } from "./renderModel";
type Mask = NonNullable<RenderTerrainView["mask"]>;
const palette = { plain: "#ffffff", earth: "#5d5040", wood: "#8f6e4e" };
const viewport = { minX: 0, minY: 0, maxX: 40, maxY: 40 };
const chunk = (cx: number, material = 1) => ({ cx, cy: 0, values: Array(256).fill(material) as number[] });
const mask = (...chunks: NonNullable<Mask["source"]>["chunks"]): Mask => ({ origin: { x: 0, y: 0 }, sampleSize: .25,
  entries: new Map(), source: { codes: ["earth", "wood"], chunks } });
describe("incremental mask tiles", () => {
  it.each([4, 8] as const)("keeps source pixels and halo across smaller %s-sample tiles", size => {
    const m = mask(chunk(0), chunk(1, 2)), raster = buildTerrainMaskRaster(m, 40, 40, palette, true)!;
    for (const tile of terrainMaskTiles(m, 40, 40, palette, viewport, size)) {
      const side = tile.size + 2;
      for (let py = 0; py < side; py++) for (let px = 0; px < side; px++) {
        const sx = tile.cx * size + px - 1, sy = tile.cy * size + py - 1;
        // Whole-raster bounds include exactly one outer sample halo.
        if (sx < raster.minSX || sy < raster.minSY || sx >= raster.minSX + raster.width || sy >= raster.minSY + raster.height) continue;
        const at = ((sy - raster.minSY) * raster.width + sx - raster.minSX) * 4;
        expect(tile.pixels.slice((py * side + px) * 4, (py * side + px) * 4 + 4)).toEqual(raster.pixels.slice(at, at + 4));
      }
    }
  });
  it("matches whole-raster colors/grain and map-edge extension, including a chunk seam", () => {
    const m = mask(chunk(0), chunk(1, 2)), raster = buildTerrainMaskRaster(m, 40, 40, palette, true)!;
    for (const tile of terrainMaskTiles(m, 40, 40, palette, viewport)) {
      if (tile.cy !== 0 || tile.cx > 1) continue;
      for (let py = 0; py < 18; py++) for (let px = 0; px < 18; px++) {
        const sx = tile.cx * 16 + px - 1, sy = py - 1;
        const at = ((sy - raster.minSY) * raster.width + sx - raster.minSX) * 4;
        expect(tile.pixels.slice((py * 18 + px) * 4, (py * 18 + px) * 4 + 4)).toEqual(raster.pixels.slice(at, at + 4));
      }
    }
  });
  it("reuses untouched distant tiles and invalidates a neighbor halo when painting/erasing", () => {
    const a = chunk(0), b = chunk(1), far = chunk(6);
    const before = terrainMaskTiles(mask(a, b, far), 40, 40, palette, viewport);
    const changed = { ...b, values: [...b.values] }; changed.values[0] = 2;
    const after = terrainMaskTiles(mask(a, changed, far), 40, 40, palette, viewport);
    const find = (tiles: typeof before, cx: number) => tiles.find(t => t.cx === cx && t.cy === 0)!;
    expect(find(after, 6)).toBe(find(before, 6));
    expect(find(after, 0)).not.toBe(find(before, 0));
    const erased = terrainMaskTiles(mask(a, far), 40, 40, palette, viewport);
    expect(find(erased, 0).pixels[(1 * 18 + 17) * 4 + 3]).toBe(0);
    expect(find(after, 0).pixels[(1 * 18 + 17) * 4 + 3]).toBe(255);
  });
  it("плитки одной поверхности: только её куски, без разворачивания маски в клетки", () => {
    const m = mask(chunk(0), chunk(100, 2));
    Object.defineProperty(m, "entries", { get: () => { throw Error("must not expand samples"); } });
    const tiles = terrainEdgeTiles(m, 500, 40, { ...viewport, maxX: 500 }, 1, [0, 1], 1);
    expect(tiles.some(t => t.cx === 100)).toBe(true);
    expect(tiles.some(t => t.cx === 0)).toBe(false);
    expect(maskSampleCode(m, 1600, 0)).toBe("wood");
    expect(tiles.find(t => t.cx === 100 && t.cy === 0)!.field[9 * 18 + 9]).toBe(1);
    expect(terrainEdgeTiles(mask(chunk(0)), 40, 40, viewport, 1, [0, 1], 1)).toEqual([]);
  });
  it("нижняя поверхность заходит под верхнюю, верхняя кончается на своей границе", () => {
    // Земля слева, дерево справа; граница — между отсчётами 15 и 16.
    const m = mask(chunk(0), chunk(1, 2));
    const at = (tiles: ReturnType<typeof terrainEdgeTiles>, sx: number) => { const tile = tiles.find(t => t.cy === 0 && t.cx === Math.floor(sx / 16))!; return tile ? tile.field[9 * 18 + sx - tile.cx * 16 + 1] : 0; };
    const lower = terrainEdgeTiles(m, 40, 40, viewport, 0, [0, 1], 1), upper = terrainEdgeTiles(m, 40, 40, viewport, 1, [0, 1], 1);
    expect([15, 16, 20, 21].map(sx => at(lower, sx))).toEqual([1, 1, 1, 0]);
    expect([15, 16].map(sx => at(upper, sx))).toEqual([0, 1]);
    // Те же поверхности в обратном порядке: теперь под соседа заходит дерево.
    expect(at(terrainEdgeTiles(m, 40, 40, viewport, 1, [1, 0], 1), 12)).toBe(1);
    // Широкая кромка: переход размазан на три отсчёта вокруг границы.
    const wide = terrainEdgeTiles(m, 40, 40, viewport, 1, [0, 1], 3);
    expect([14, 15, 16, 17].map(sx => Math.round(at(wide, sx) * 3))).toEqual([0, 1, 2, 3]);
  });
  it("край плитки не пересчитывается, когда вдали меняется другой материал", () => {
    const a = chunk(0), b = chunk(1, 2), before = mask(a, b);
    const original = terrainEdgeTiles(before, 40, 40, viewport, 0, [0, 1], 1);
    const changed = { ...b, values: [...b.values] }; changed.values[8 * 16 + 12] = 0;
    const after = terrainEdgeTiles(mask(a, changed), 40, 40, viewport, 0, [0, 1], 1);
    expect(after).toHaveLength(original.length);
    after.forEach((tile, i) => expect(tile).toBe(original[i]));
    const originalColor = terrainMaskTiles(before, 40, 40, palette, viewport);
    const changedColor = terrainMaskTiles(mask(a, changed), 40, 40, palette, viewport);
    expect(changedColor.find(t => t.cx === 0 && t.cy === 0)).toBe(originalColor.find(t => t.cx === 0 && t.cy === 0));
    expect(changedColor.find(t => t.cx === 1 && t.cy === 0)).not.toBe(originalColor.find(t => t.cx === 1 && t.cy === 0));
  });
  it("skips transparent colors and unused materials while retaining textured alpha", () => {
    const m = mask(chunk(0));
    expect(terrainMaskTiles(m, 40, 40, { ...palette, earth: "#00000000" }, viewport)).toEqual([]);
  });
});
