import { describe, expect, it } from "vitest";
import { edgeAlpha, edgeField, engineNoise } from "./surfaceEdge";

// Поверхность занимает отсчёты x < 4; правее — пусто.
const half = (sx: number) => sx < 4 ? 0 : -Infinity;
const alphaRow = (field: Float32Array, n: number, side: number, o: { ramp: number; rough: number }) => {
  const out = new Uint8ClampedArray(side * side * 4);
  edgeAlpha(field, n, out, side, { ...o, noise: engineNoise(), x: 0, y: 0, perUnit: side / (n * 0.25) });
  return (py: number) => Array.from({ length: side }, (_, px) => out[(py * side + px) * 4 + 3]);
};

describe("кромка поверхности", () => {
  it("шум движка бесшовный и занимает весь диапазон", () => {
    const { data, side } = engineNoise();
    expect(Math.min(...data)).toBe(0); expect(Math.max(...data)).toBe(255);
    // Через шов повтора значения идут так же плавно, как внутри.
    for (let y = 0; y < side; y += 16) expect(Math.abs(data[y * side] - data[y * side + side - 1])).toBeLessThan(24);
  });
  it("под верхнюю поверхность заходит только соседняя: через полоску третьей не перепрыгивает", () => {
    // Вода (1) до x = 3, полоска грязи (0) на x = 4–5, дальше трава (2). Грязь ниже обеих и заходит под обе.
    const rankAt = (sx: number) => sx < 4 ? 1 : sx < 6 ? 0 : 2;
    const water = edgeField(12, 0, 0, rankAt, 1, 1), mud = edgeField(12, 0, 0, rankAt, 0, 1);
    expect([3, 4, 6, 7].map(x => water[5 * 12 + x])).toEqual([1, 0, 0, 0]);
    expect([3, 4, 5, 6, 10, 11].map(x => mud[5 * 12 + x])).toEqual([1, 1, 1, 1, 1, 0]);
  });
  it("под узкой полосой верхней поверхности нижняя доходит только до середины", () => {
    // Трава (0) до x = 3, брусчатка (2) на x = 4–7, дальше пусто.
    const grass = edgeField(12, 0, 0, sx => sx < 4 ? 0 : sx < 8 ? 2 : -Infinity, 0, 1);
    expect([3, 4, 5, 6, 7].map(x => grass[5 * 12 + x])).toEqual([1, 1, 1, 0, 0]);
  });
  it("ровный край: прозрачность растёт плавно, середина перехода — на границе", () => {
    const field = edgeField(8, 0, 0, half, 0, 1), row = alphaRow(field, 8, 64, { ramp: 1, rough: 0 })(32);
    expect(row[0]).toBe(255); expect(row[63]).toBe(0);
    expect(row[31]).toBeGreaterThan(110); expect(row[32]).toBeLessThan(145);
    expect(row.every((value, i) => !i || value <= row[i - 1])).toBe(true);
  });
  it("нулевая ширина — чёткий край: переход укладывается в пару точек", () => {
    const field = edgeField(8, 0, 0, half, 0, 1), row = alphaRow(field, 8, 64, { ramp: 0, rough: 0 })(32);
    expect(row.filter(value => value > 0 && value < 255).length).toBeLessThanOrEqual(2);
    expect(row[30]).toBe(255); expect(row[33]).toBe(0);
  });
  it("рваный край: граница гуляет от строки к строке, а середина поверхности остаётся целой", () => {
    const field = edgeField(8, 0, 0, half, 0, 4), rows = alphaRow(field, 8, 64, { ramp: 4, rough: 1 });
    const edges = new Set(Array.from({ length: 64 }, (_, py) => rows(py).findIndex(value => value < 128)));
    expect(edges.size).toBeGreaterThan(4);
    for (let py = 0; py < 64; py += 8) { expect(rows(py)[0]).toBe(255); expect(rows(py)[63]).toBe(0); }
  });
});
