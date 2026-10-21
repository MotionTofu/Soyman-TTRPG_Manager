import { isPaletteIndexMaskPayload, maskChunkCoords, TERRAIN_MASK_CHUNK_AREA, TERRAIN_MASK_ENCODING } from "@shared/maps/core/terrainMask";
import { liquidKey, waterCode, waterLevel } from "../assets/village";
import type { MapDocumentV5, MapLayer, TerrainMaskLayer } from "../core/types";
import { changed, mutationError, noChange } from "../core/mutations/helpers";
import { layerRole } from "../core/mutations/layers";
import type { MutationResult } from "../core/mutations/types";

/** Жидкости живут своим плавным слоем поверх поверхностей (решение владельца 2026-10-08): ластик открывает землю под водой.
 * Слой узнаётся по роли (`role: "liquids"`), у старых карт — по имени. */
export const LIQUID_LAYER = "Жидкости";
/** Столько жидкостей помещается в маску воды; это и есть число слотов. */
export const LIQUID_SLOTS = 7;
export const isLiquidLayer = (layer: { kind: string; name: string; representation?: string }): layer is TerrainMaskLayer =>
  layer.kind === "terrain" && layerRole(layer as MapLayer) === "liquids";
/** Слой стен: ограды, частоколы, кладка. Дороги и реки в него не ложатся. */
export const WALL_LAYER = "Стены";
export const isWallLayer = (layer: { kind: string; name: string }) => layer.kind === "path" && layerRole(layer as MapLayer) === "walls";

const code = (material: { type: string; key?: string }) => material.type === "builtin" ? material.key!.replace(/^terrain\//, "") : "";
/** Занятые слоты — жидкости, которые сейчас накрашены на карте (стёртая целиком слот освобождает). */
export function usedLiquids(layers: readonly { kind: string; name: string }[]): string[] {
  const layer = (layers as readonly MapLayer[]).find(isLiquidLayer);
  if (!layer) return [];
  const live = new Set<number>();
  for (const chunk of layer.mask.chunks) if (isPaletteIndexMaskPayload(chunk.payload, layer.mask.materials.length)) for (const value of chunk.payload.values) if (value) live.add(value);
  return [...new Set(layer.mask.materials.map(code).filter((item, i) => live.has(i + 1) && waterLevel(item) > 0).map(liquidKey))];
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

/** Освободить слот: всё, что накрашено жидкостью `from`, стирается (`to === null`) или становится жидкостью `to` той же глубины. */
export function replaceLiquid(doc: MapDocumentV5, from: string, to: string | null): MutationResult {
  const target = doc.layers.find(isLiquidLayer);
  if (!target) return noChange(doc);
  const materials = [...target.mask.materials];
  const swap = target.mask.materials.map((material, i) => {
    const old = code(material);
    if (!waterLevel(old) || liquidKey(old) !== from) return i + 1;
    if (to === null) return 0;
    const next = `terrain/${waterCode(waterLevel(old), to)}`;
    return materials.findIndex(entry => entry.type === "builtin" && entry.key === next) + 1 || materials.push({ type: "builtin", key: next });
  });
  if (swap.every((index, i) => index === i + 1)) return noChange(doc);
  const chunks = target.mask.chunks.flatMap(chunk => {
    if (!isPaletteIndexMaskPayload(chunk.payload, target.mask.materials.length)) return [chunk];
    const values = chunk.payload.values.map(value => value ? swap[value - 1] : 0);
    return values.some(Boolean) ? [{ ...chunk, payload: { encoding: TERRAIN_MASK_ENCODING, values } }] : [];
  });
  const layers = [...doc.layers];
  layers[layers.indexOf(target)] = { ...target, mask: { ...target.mask, materials, chunks } };
  return changed({ ...doc, layers });
}

/** «Глубина» и «Блик» по «Середине»: тот же оттенок, темнее и насыщеннее вглубь, светлее и бледнее к блику. */
export function liquidShades(mid: string): [string, string] {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(mid.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const hex = (light: number, sat: number) => {
    const c = (1 - Math.abs(2 * light - 1)) * sat, x = c * (1 - Math.abs(h % 2 - 1)), m = light - c / 2;
    return "#" + [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
  };
  return [hex(l * 0.45, Math.min(1, s * 1.1)), hex(l + (1 - l) * 0.78, s * 0.6)];
}
