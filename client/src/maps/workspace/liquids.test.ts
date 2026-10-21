import { expect, it } from "vitest";
import { TERRAIN_MASK_ENCODING } from "@shared/maps/core/terrainMask";
import type { MapDocumentV5 } from "../core/types";
import { LIQUID_LAYER, liquidShades, moveLiquidsToLayer, moveRiversOutOfRoads, pathLayerFits, replaceLiquid, usedLiquids } from "./liquids";

const mat = (code: string) => ({ type: "builtin" as const, key: `terrain/${code}` });
const chunk = (id: string, set: Record<number, number>) => ({ id, cx: 0, cy: 0, payload: { encoding: TERRAIN_MASK_ENCODING, values: Array.from({ length: 256 }, (_, i) => set[i] ?? 0) } });
const layer = (id: string, name: string, materials: string[], chunks: ReturnType<typeof chunk>[]) => ({ id, name, visible: true, locked: false, opacity: 1, kind: "terrain" as const,
  representation: "mask" as const, defaultMaterial: mat("plain"), mask: { origin: { x: 0, y: 0 }, sampleSize: 0.25, materials: materials.map(mat), chunks } });
const values = (doc: MapDocumentV5, id: string) => { const found = doc.layers.find(entry => entry.id === id); return found?.kind === "terrain" && found.representation === "mask" ? found.mask.chunks.map(entry => (entry.payload as { values: number[] }).values) : []; };

it("старая вода переезжает в слой жидкостей, земля поверх неё воду не пускает", () => {
  const doc = { layers: [
    layer("low", "Поверхность", ["village-grass", "village-water-3", "village-lava-4"], [chunk("a", { 0: 1, 1: 2, 2: 3, 3: 2 })]),
    layer("high", "Поверхность 2", ["village-sand"], [chunk("b", { 3: 1 })]),
    layer("wet", LIQUID_LAYER, ["plain"], []),
  ] } as unknown as MapDocumentV5;
  const result = moveLiquidsToLayer(doc, "wet", () => "new");
  if (!result.ok) throw new Error("не применилось");
  expect(values(result.document, "low")[0].slice(0, 4)).toEqual([1, 0, 0, 0]);
  // Отсчёт 3 закрыт песком слоя выше: вода под ним не всплывает.
  expect(values(result.document, "wet")[0].slice(0, 4)).toEqual([0, 2, 3, 0]);
  expect(usedLiquids(result.document.layers)).toEqual(["water", "lava"]);
  expect(moveLiquidsToLayer(result.document, "wet", () => "x")).toMatchObject({ ok: true, changed: false });
});

it("освобождение слота: жидкость стирается или становится другой той же глубины", () => {
  const doc = { layers: [layer("wet", LIQUID_LAYER, ["village-water-3", "village-own1-5"], [chunk("a", { 0: 1, 1: 2 })])] } as unknown as MapDocumentV5;
  const swapped = replaceLiquid(doc, "own1", "lava"), erased = replaceLiquid(doc, "own1", null);
  if (!swapped.ok || !erased.ok) throw new Error("не применилось");
  expect(usedLiquids(swapped.document.layers)).toContain("lava");
  expect(values(swapped.document, "wet")[0].slice(0, 2)).toEqual([1, 3]);
  expect(values(erased.document, "wet")[0].slice(0, 2)).toEqual([1, 0]);
  expect(replaceLiquid(doc, "tar", null)).toMatchObject({ changed: false });
});

it("река своей жидкостью держит слот; освобождение слота переводит её в другую жидкость или в воду", () => {
  const river = (liquid?: string) => ({ id: "r", kind: "river", properties: liquid ? { liquid } : {} });
  const doc = { layers: [layer("wet", LIQUID_LAYER, ["village-water-3"], [chunk("a", { 0: 1 })]),
    { id: "p", kind: "path", name: "Реки", paths: [river("own1")] }] } as unknown as MapDocumentV5;
  expect(usedLiquids(doc.layers)).toEqual(["water", "own1"]);
  const swapped = replaceLiquid(doc, "own1", "lava"), erased = replaceLiquid(doc, "own1", null);
  if (!swapped.ok || !erased.ok) throw new Error("не применилось");
  expect(usedLiquids(swapped.document.layers)).toEqual(["water", "lava"]);
  expect(usedLiquids(erased.document.layers)).toEqual(["water"]);
});

it("глубина и блик подбираются по середине: темнее и светлее того же оттенка", () => {
  const sum = (hex: string) => [1, 3, 5].reduce((total, at) => total + parseInt(hex.slice(at, at + 2), 16), 0);
  for (const mid of ["#15937f", "#c8402a", "#808080", "#f0e68c", "#101030"]) {
    const [deep, light] = liquidShades(mid);
    expect(deep).toMatch(/^#[0-9a-f]{6}$/); expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(sum(deep)).toBeLessThan(sum(mid)); expect(sum(light)).toBeGreaterThan(sum(mid));
  }
  expect(liquidShades("#808080")).toEqual(["#3a3a3a", "#e3e3e3"]);
});

it("реки из слоя дорог переезжают в слой рек; инструмент встаёт в слой своей роли или в общий", () => {
  const line = (id: string, kind: string) => ({ id, kind, properties: {} });
  const path = (id: string, name: string, paths: object[], role?: string) => ({ id, name, kind: "path", visible: true, locked: false, opacity: 1, paths, ...(role ? { role } : {}) });
  const doc = { layers: [path("lyr-river", "Rivers", [line("a", "river")]), path("lyr-road", "Roads", [line("b", "road"), line("c", "river")])] } as unknown as MapDocumentV5;
  const moved = moveRiversOutOfRoads(doc, () => "new");
  expect(moved.layers.map(layer => layer.kind === "path" ? layer.paths.map(entry => entry.id) : [])).toEqual([["a", "c"], ["b"]]);
  expect(moveRiversOutOfRoads(moved, () => "x")).toBe(moved);
  // Слоя рек нет — заводится под дорогами.
  const bare = moveRiversOutOfRoads({ layers: [path("r", "Дороги", [line("c", "river")])] } as unknown as MapDocumentV5, () => "new");
  expect(bare.layers.map(layer => [layer.id, layer.role])).toEqual([["new", "rivers"], ["r", undefined]]);
  const roads = path("r", "Дороги", []), common = path("m", "Реки и дороги", []), walls = path("w", "Ограды", [], "walls");
  expect([pathLayerFits("river", roads), pathLayerFits("river", common), pathLayerFits("road", roads), pathLayerFits("road", walls), pathLayerFits("wall", common)])
    .toEqual([false, true, true, false, false]);
});
