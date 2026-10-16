import { describe, expect, it } from "vitest";
import { ATLAS_BLOCK, atlasBlocks, contour } from "./atlasWater";
import type { MapRenderModel } from "./renderModel";

const SIZE = 0.25;
/** Карта W×H клеток, отсчёт в четверть клетки; `code` решает, что накрашено в точке. */
function map(w: number, h: number, code: (x: number, y: number) => number) {
  const chunks: { cx: number; cy: number; values: number[] }[] = [];
  for (let cy = 0; cy * 16 * SIZE < h; cy++) for (let cx = 0; cx * 16 * SIZE < w; cx++) {
    const values: number[] = [];
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) values.push(code((cx * 16 + i + 0.5) * SIZE, (cy * 16 + j + 0.5) * SIZE));
    chunks.push({ cx, cy, values });
  }
  return chunks;
}
const model = (chunks: { cx: number; cy: number; values: number[] }[]) => ({ layers: [{ kind: "terrain", visible: true,
  terrain: { mask: { origin: { x: 0, y: 0 }, sampleSize: SIZE, source: { codes: ["world-meadow", "village-water-2", "village-water-5"], chunks } } } }] }) as unknown as MapRenderModel;
const all = (w: number, h: number) => ({ x0: 0, y0: 0, x1: w, y1: h });
const inside = (lines: { points: Float32Array }[], test: (x: number, y: number) => boolean) =>
  lines.some(line => { for (let i = 0; i < line.points.length; i += 2) if (test(line.points[i], line.points[i + 1])) return true; return false; });

describe("atlas water", () => {
  it("traces a level of a field as one closed line", () => {
    const w = 40, h = 30, field = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) field[y * w + x] = Math.hypot(x - 20, y - 15) < 8 ? 1 : 0;
    const [lines] = contour(field, w, h, [0.5]);
    expect(lines).toHaveLength(1);
    expect(lines[0].closed).toBe(true);
  });

  it("draws the coast, hatches wide water and leaves a narrow channel clean", () => {
    // Суша посередине, сквозь неё — протока в полклетки; вокруг море.
    const chunks = map(32, 24, (x, y) => x > 8 && x < 24 && y > 6 && y < 18 ? (y > 11.75 && y < 12.25 && x < 20 ? 2 : 1) : 2);
    const blocks = atlasBlocks(model(chunks), 32, 24, { x: 0, y: 0 }, 0, null, all(32, 24));
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every(block => block.coast.every(line => line.closed))).toBe(true);
    const hatch = blocks.flatMap(block => block.hatch);
    expect(inside(hatch, (x, y) => x < 7.5 && y > 8 && y < 16)).toBe(true);
    expect(inside(hatch, (x, y) => x > 10 && x < 18 && y > 11 && y < 13)).toBe(false);
    // Волны — только в открытой воде, дальше полутора клеток от суши.
    expect(blocks.flatMap(block => block.waves).every(wave => !(wave.x > 7 && wave.x < 25 && wave.y > 5 && wave.y < 19))).toBe(true);
  });

  it("finds deeper tones where the sea is painted deeper", () => {
    const chunks = map(32, 16, (x) => x < 6 ? 1 : x < 20 ? 2 : 3);
    const blocks = atlasBlocks(model(chunks), 32, 16, { x: 0, y: 0 }, 0, null, all(32, 16));
    const deep = blocks.flatMap(block => block.tones[1]);
    expect(inside(deep, (x) => x > 22)).toBe(true);
    expect(inside(deep, (x) => x < 16)).toBe(false);
  });

  it("recomputes only the blocks under a changed chunk", () => {
    const chunks = map(48, 24, (x, y) => Math.hypot(x - 24, y - 12) < 7 ? 1 : 2);
    const before = atlasBlocks(model(chunks), 48, 24, { x: 0, y: 0 }, 0, null, all(48, 24));
    const changed = chunks.map(chunk => chunk.cx === 0 && chunk.cy === 0 ? { ...chunk, values: chunk.values.map(() => 1) } : chunk);
    const after = atlasBlocks(model(changed), 48, 24, { x: 0, y: 0 }, 0, null, all(48, 24));
    const far = (block: { rect: { x0: number; y0: number } }) => block.rect.x0 >= 3 * ATLAS_BLOCK;
    expect(after.filter(far).every(block => before.includes(block))).toBe(true);
    expect(after.find(block => block.rect.x0 === 0 && block.rect.y0 === 0)).not.toBe(before.find(block => block.rect.x0 === 0 && block.rect.y0 === 0));
  });

  it("has no blocks on dry land", () => {
    expect(atlasBlocks(model(map(16, 16, () => 1)), 16, 16, { x: 0, y: 0 }, 0, null, all(16, 16))).toEqual([]);
  });
});
