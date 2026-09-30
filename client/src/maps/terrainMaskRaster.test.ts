import { describe, expect, it } from "vitest";
import { MAP_TERRAIN_FILL } from "./render";
import { buildTerrainMaskRaster } from "./terrainMaskRaster";

const origin = { x: 0, y: 0 };
const sampleSize = 0.25;

describe("terrain mask raster", () => {
  it("keeps painted sample colors and transparent samples separate for smoothing", () => {
    const raster = buildTerrainMaskRaster({
      origin, sampleSize,
      entries: new Map([["2,2", "forest"], ["3,2", "desert"]]),
    }, 8, 8, MAP_TERRAIN_FILL);
    expect(raster).not.toBeNull();
    if (!raster) return;
    expect([raster.minSX, raster.minSY, raster.width, raster.height]).toEqual([1, 1, 4, 3]);
    const pixel = (sx: number, sy: number) => {
      const offset = ((sy - raster.minSY) * raster.width + sx - raster.minSX) * 4;
      return Array.from(raster.pixels.slice(offset, offset + 4));
    };
    expect(pixel(1, 2)).toEqual([0, 0, 0, 0]);
    expect(pixel(2, 2)).toEqual([117, 148, 111, 255]);
    expect(pixel(3, 2)).toEqual([211, 188, 135, 255]);
    expect(pixel(2, 1)).toEqual([0, 0, 0, 0]);
  });

  it("extends painted samples at the map edge so the perimeter does not fade", () => {
    const mask = {
      origin, sampleSize,
      entries: new Map([["0,0", "forest"]]),
    };
    const raster = buildTerrainMaskRaster(mask, 8, 8, MAP_TERRAIN_FILL, true);
    expect(raster).not.toBeNull();
    if (!raster) return;
    const alpha = (sx: number, sy: number) =>
      raster.pixels[((sy - raster.minSY) * raster.width + sx - raster.minSX) * 4 + 3];
    expect(alpha(-1, 0)).toBe(255);
    expect(alpha(0, -1)).toBe(255);
    expect(alpha(-1, -1)).toBe(255);
    expect(alpha(1, 0)).toBe(0);
    const rgba = (sx: number, sy: number) => {
      const offset = ((sy - raster.minSY) * raster.width + sx - raster.minSX) * 4;
      return Array.from(raster.pixels.slice(offset, offset + 4));
    };
    expect(rgba(-1, 0)).toEqual(rgba(0, 0));
  });

  it("declines an overly large sparse raster so the renderer can use rectangles", () => {
    const raster = buildTerrainMaskRaster({
      origin, sampleSize: 0.25,
      entries: new Map([["0,0", "forest"], ["1200,0", "forest"]]),
    }, 400, 8, MAP_TERRAIN_FILL);
    expect(raster).toBeNull();
  });

  it("adds stable material grain without changing mask opacity", () => {
    const mask = { origin, sampleSize, entries: new Map([["2,2", "forest"], ["4,2", "forest"]]) };
    const base = buildTerrainMaskRaster(mask, 8, 8, MAP_TERRAIN_FILL);
    const textured = buildTerrainMaskRaster(mask, 8, 8, MAP_TERRAIN_FILL, true);
    expect(base && textured).toBeTruthy();
    if (!base || !textured) return;
    expect(textured.pixels).toEqual(buildTerrainMaskRaster(mask, 8, 8, MAP_TERRAIN_FILL, true)?.pixels);
    const pixel = (raster: typeof textured, sx: number, sy: number) => {
      const offset = ((sy - raster.minSY) * raster.width + sx - raster.minSX) * 4;
      return Array.from(raster.pixels.slice(offset, offset + 4));
    };
    expect(pixel(textured, 2, 2)[3]).toBe(255);
    expect(pixel(textured, 1, 2)[3]).toBe(0);
    expect(pixel(textured, 2, 2).slice(0, 3)).not.toEqual(pixel(textured, 4, 2).slice(0, 3));
    expect(pixel(textured, 2, 2).slice(0, 3)).not.toEqual(pixel(base, 2, 2).slice(0, 3));
  });

  it("anchors texture to map coordinates when painted bounds change", () => {
    const near = { origin, sampleSize, entries: new Map([["2,2", "forest"]]) };
    const wider = { origin, sampleSize, entries: new Map([["0,2", "forest"], ["2,2", "forest"]]) };
    const textureAt = (mask: typeof near) => {
      const raster = buildTerrainMaskRaster(mask, 8, 8, MAP_TERRAIN_FILL, true);
      if (!raster) throw new Error("fixture failed");
      const x = 2 - raster.minSX;
      const y = 2 - raster.minSY;
      return Array.from(raster.pixels.slice((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4));
    };
    expect(textureAt(near)).toEqual(textureAt(wider));
  });
});

it("dense chunk source and entry fallback produce identical textured pixels", () => {
  const values = Array.from({ length: 256 }, (_, i) => i % 3 ? 1 : 2);
  const entries = new Map<string, string>();
  for (let i = 0; i < values.length; i++) entries.set(`${i % 16},${Math.floor(i / 16)}`, values[i] === 1 ? "forest" : "shallow_water");
  const mask = { origin, sampleSize, entries };
  const fallback = buildTerrainMaskRaster(mask, 8, 8, MAP_TERRAIN_FILL, true);
  const dense = buildTerrainMaskRaster({ ...mask, source: { codes: ["forest", "shallow_water"], chunks: [{ cx: 0, cy: 0, values }] } }, 8, 8, MAP_TERRAIN_FILL, true);
  expect(dense).toEqual(fallback);
});
