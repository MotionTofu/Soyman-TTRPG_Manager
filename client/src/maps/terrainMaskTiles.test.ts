import { describe, expect, it } from "vitest";
import { maskSampleCode, terrainMaskTiles } from "./terrainMaskTiles";
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
    for (const tile of terrainMaskTiles(m, 40, 40, palette, viewport, undefined, size)) {
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
  it("filters alpha by material, avoids expanding entries and covers huge sparse bounds", () => {
    const m = mask(chunk(0), chunk(100, 2));
    Object.defineProperty(m, "entries", { get: () => { throw Error("must not expand samples"); } });
    const tiles = terrainMaskTiles(m, 500, 40, palette, { ...viewport, maxX: 500 }, ["wood"]);
    expect(tiles.some(t => t.cx === 100)).toBe(true);
    expect(tiles.some(t => t.cx === 0)).toBe(false);
    expect(maskSampleCode(m, 1600, 0)).toBe("wood");
    expect(tiles.find(t => t.cx === 100 && t.cy === 0)!.pixels.slice((1 * 18 + 1) * 4, (1 * 18 + 1) * 4 + 4)).toEqual(new Uint8ClampedArray([255, 255, 255, 255]));
  });
  it("keeps texture alpha when another material or a neighbor interior changes", () => {
    const a = chunk(0), b = chunk(1, 2), before = mask(a, b);
    const original = terrainMaskTiles(before, 40, 40, palette, viewport, ["earth"]);
    const changed = { ...b, values: [...b.values] }; changed.values[8 * 16 + 8] = 0;
    const after = terrainMaskTiles(mask(a, changed), 40, 40, palette, viewport, ["earth"]);
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
    expect(terrainMaskTiles(m, 40, 40, palette, viewport, ["wood"])).toEqual([]);
    const alpha = terrainMaskTiles(m, 40, 40, palette, viewport, ["earth"], 4);
    expect(alpha.some(tile => tile.pixels[3] === 255)).toBe(true);
  });
});
