import { isPaletteIndexMaskPayload, maskChunkCoords, TERRAIN_MASK_CHUNK_AREA, TERRAIN_MASK_ENCODING } from "@shared/maps/core/terrainMask";
import { LIQUIDS, liquidKind, waterLevel, type LiquidKey } from "../assets/village";
import type { MapDocumentV5, MapLayer, TerrainMaskLayer } from "../core/types";
import { changed, mutationError, noChange } from "../core/mutations/helpers";
import type { MutationResult } from "../core/mutations/types";

/** Жидкости живут своим плавным слоем поверх поверхностей (решение владельца 2026-10-08): ластик открывает землю под водой.
 * Слой узнаётся по имени, как слой «Стены». */
export const LIQUID_LAYER = "Жидкости";
/** Столько жидкостей помещается в маску воды; это и есть число слотов. */
export const LIQUID_SLOTS = 7;
export const isLiquidLayer = (layer: { kind: string; name: string; representation?: string }): layer is TerrainMaskLayer =>
  layer.kind === "terrain" && layer.representation === "mask" && layer.name === LIQUID_LAYER;

const code = (material: { type: string; key?: string }) => material.type === "builtin" ? material.key!.replace(/^terrain\//, "") : "";
/** Занятые слоты — жидкости, которыми на карте уже красили. */
export function usedLiquids(layers: readonly { kind: string; name: string }[]): LiquidKey[] {
  const layer = (layers as readonly MapLayer[]).find(isLiquidLayer);
  return [...new Set((layer?.mask.materials ?? []).map(code).filter(item => waterLevel(item) > 0).map(item => LIQUIDS[liquidKind(item)].key))];
}

/** Вода, накрашенная кистью поверхности до появления слоя жидкостей, переезжает в него. Землю, накрашенную поверх
 * воды в слое выше, вода не закрывает: такая вода просто пропадает, как и не была видна. */
export function moveLiquidsToLayer(doc: MapDocumentV5, layerId: string, newChunkId: () => string): MutationResult {
  const target = doc.layers.find(layer => layer.id === layerId);
  if (!target || !isLiquidLayer(target)) return mutationError("liquids.wrong-layer", "layerId", "expected the liquid layer");
  const at = (chunk: { cx: number; cy: number }, i: number) => (chunk.cx * 16 + i % 16 + 32768) * 65536 + chunk.cy * 16 + (i >> 4) + 32768;
  const materials = [...target.mask.materials], covered = new Set<number>(), moved = new Map<number, number>();
  for (const chunk of target.mask.chunks) if (isPaletteIndexMaskPayload(chunk.payload, materials.length))
    chunk.payload.values.forEach((value, i) => { if (value) covered.add(at(chunk, i)); });
  const layers = [...doc.layers];
  for (let n = layers.length - 1; n >= 0; n--) {
    const layer = layers[n];
    if (layer.id === layerId || layer.kind !== "terrain" || layer.representation !== "mask") continue;
    const mask = layer.mask;
    if (mask.sampleSize !== target.mask.sampleSize || mask.origin.x !== target.mask.origin.x || mask.origin.y !== target.mask.origin.y) continue;
    const liquid = mask.materials.map(material => waterLevel(code(material)) > 0);
    let touched = false;
    const chunks = mask.chunks.flatMap(chunk => {
      if (!isPaletteIndexMaskPayload(chunk.payload, mask.materials.length)) return [chunk];
      const old = chunk.payload.values, wet = old.some(value => value && liquid[value - 1]);
      const next = old.map((value, i) => {
        if (!value) return 0;
        const key = at(chunk, i), free = !covered.has(key);
        covered.add(key);
        if (!liquid[value - 1]) return value;
        if (free) {
          const material = mask.materials[value - 1];
          let index = materials.findIndex(entry => code(entry) === code(material)) + 1;
          if (!index) index = materials.push(material);
          moved.set(key, index);
        }
        return 0;
      });
      if (!wet) return [chunk];
      touched = true;
      return next.some(Boolean) ? [{ ...chunk, payload: { encoding: TERRAIN_MASK_ENCODING, values: next } }] : [];
    });
    if (touched) layers[n] = { ...layer, mask: { ...mask, chunks } };
  }
  if (!moved.size) return noChange(doc);
  const values = new Map<string, { cx: number; cy: number; id: string; values: number[] }>();
  for (const chunk of target.mask.chunks) values.set(`${chunk.cx},${chunk.cy}`, { cx: chunk.cx, cy: chunk.cy, id: chunk.id, values: [...(chunk.payload as { values: number[] }).values] });
  for (const [key, index] of moved) {
    const { cx, cy, index: i } = maskChunkCoords(Math.floor(key / 65536) - 32768, key % 65536 - 32768), name = `${cx},${cy}`;
    let chunk = values.get(name);
    if (!chunk) values.set(name, chunk = { cx, cy, id: newChunkId(), values: Array(TERRAIN_MASK_CHUNK_AREA).fill(0) });
    chunk.values[i] = index;
  }
  const chunks = [...values.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx)
    .map(chunk => ({ id: chunk.id, cx: chunk.cx, cy: chunk.cy, payload: { encoding: TERRAIN_MASK_ENCODING, values: chunk.values } }));
  layers[layers.indexOf(target)] = { ...target, mask: { ...target.mask, materials, chunks } };
  return changed({ ...doc, layers });
}
