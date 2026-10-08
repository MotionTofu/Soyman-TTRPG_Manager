import { expect, it } from "vitest";
import { TERRAIN_MASK_ENCODING } from "@shared/maps/core/terrainMask";
import type { MapDocumentV5 } from "../core/types";
import { LIQUID_LAYER, moveLiquidsToLayer, replaceLiquid, usedLiquids } from "./liquids";

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
