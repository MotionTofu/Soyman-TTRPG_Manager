import { isMaterialRef, type MaterialRef } from "../refs";
import { isPaletteIndexMaskPayload, maskChunkCoords, TERRAIN_MASK_CHUNK_AREA, TERRAIN_MASK_ENCODING } from "@shared/maps/core/terrainMask";
import type { MapDocumentV5, TerrainMaskChunk, Vec2 } from "../types";
import { changed, findLayer, mutationError, noChange, withReplacedLayer, type MutationResult } from "./helpers";

const MAX_SAMPLES_PER_DAB = 4356; // Radius 8 at quarter-cell resolution, including edge samples.
const MAX_SAMPLES_PER_FILL = 250_000;

function sameMaterial(a: MaterialRef, b: MaterialRef): boolean {
  return a.type === b.type && (a.type === "builtin" && b.type === "builtin"
    ? a.key === b.key : a.type === "asset" && b.type === "asset" && a.assetId === b.assetId);
}

function maskLayer(doc: MapDocumentV5, layerId: string) {
  const found = findLayer(doc, layerId);
  if (!found || found.layer.kind !== "terrain" || found.layer.representation !== "mask") return null;
  return { index: found.index, layer: found.layer };
}

/** Material at a world point, independent of the document's square/hex grid. */
export function readTerrainMaskAt(doc: MapDocumentV5, layerId: string, wx: number, wy: number): MaterialRef | null {
  const found = maskLayer(doc, layerId);
  if (!found || !Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  const { mask, defaultMaterial } = found.layer;
  const sx = Math.floor((wx - mask.origin.x) / mask.sampleSize);
  const sy = Math.floor((wy - mask.origin.y) / mask.sampleSize);
  const { cx, cy, index } = maskChunkCoords(sx, sy);
  const chunk = mask.chunks.find((item) => item.cx === cx && item.cy === cy);
  if (!chunk) return defaultMaterial;
  if (!isPaletteIndexMaskPayload(chunk.payload, mask.materials.length)) return null;
  const paletteIndex = chunk.payload.values[index];
  return paletteIndex === 0 ? defaultMaterial : mask.materials[paletteIndex - 1] ?? null;
}

interface MaskSample { sx: number; sy: number }

function applyMaskSamples(
  doc: MapDocumentV5,
  found: NonNullable<ReturnType<typeof maskLayer>>,
  samples: readonly MaskSample[],
  material: MaterialRef | null,
  newChunkId: () => string,
): MutationResult {
  if (material !== null && !isMaterialRef(material))
    return mutationError("terrain.mask.bad-material", "material", "expected builtin or asset material");
  if (samples.length === 0) return noChange(doc);
  const { mask } = found.layer;
  // Index zero is transparent. A painted default colour is still opaque.
  let paletteIndex = material ? mask.materials.findIndex((entry) => sameMaterial(entry, material)) + 1 : 0;
  const paletteNeedsAppend = material !== null && paletteIndex === 0;
  if (paletteNeedsAppend) paletteIndex = mask.materials.length + 1;
  const previous = new Map(mask.chunks.map((chunk) => [`${chunk.cx},${chunk.cy}`, chunk]));
  const touched = new Map<string, { cx: number; cy: number; values: number[]; old: TerrainMaskChunk | null }>();
  let dirty = false;
  for (const { sx, sy } of samples) {
    const { cx, cy, index } = maskChunkCoords(sx, sy);
    const key = `${cx},${cy}`;
    let entry = touched.get(key);
    if (!entry) {
      const old = previous.get(key) ?? null;
      if (old && !isPaletteIndexMaskPayload(old.payload, mask.materials.length))
        return mutationError("terrain.mask.unsupported-payload", "mask.chunks", "mask encoding is not supported");
      entry = { cx, cy, old, values: old ? [...(old.payload as { values: number[] }).values] : Array(TERRAIN_MASK_CHUNK_AREA).fill(0) };
      touched.set(key, entry);
    }
    if (entry.values[index] !== paletteIndex) {
      entry.values[index] = paletteIndex;
      dirty = true;
    }
  }
  if (!dirty) return noChange(doc);
  const chunks = mask.chunks.filter((chunk) => !touched.has(`${chunk.cx},${chunk.cy}`));
  for (const entry of touched.values()) {
    if (entry.values.every((index) => index === 0)) continue;
    chunks.push({
      id: entry.old?.id ?? newChunkId(), cx: entry.cx, cy: entry.cy,
      payload: { encoding: TERRAIN_MASK_ENCODING, values: entry.values },
    });
  }
  chunks.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const materials = paletteNeedsAppend ? [...mask.materials, material!] : mask.materials;
  return changed(withReplacedLayer(doc, found.index, { ...found.layer, mask: { ...mask, materials, chunks } }));
}

/** Paint a circular dab into a sparse 16×16 sample mask. Null makes it transparent. */
export function paintTerrainMask(
  doc: MapDocumentV5,
  layerId: string,
  wx: number,
  wy: number,
  radius: number,
  material: MaterialRef | null,
  newChunkId: () => string,
): MutationResult {
  const found = maskLayer(doc, layerId);
  if (!found) return mutationError("terrain.mask.wrong-layer", "layerId", "expected a mask terrain layer");
  const collected = dabSamples(doc, found.layer.mask, wx, wy, radius);
  return Array.isArray(collected) ? applyMaskSamples(doc, found, collected, material, newChunkId) : collected;
}

function dabSamples(doc: MapDocumentV5, mask: NonNullable<ReturnType<typeof maskLayer>>["layer"]["mask"], wx: number, wy: number, radius: number): MaskSample[] | MutationResult {
  if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(radius) || radius < 0)
    return mutationError("terrain.mask.bad-dab", "position", "expected finite world point and non-negative radius");
  const step = mask.sampleSize;
  if (!Number.isFinite(step) || step <= 0) return mutationError("terrain.mask.bad-sample-size", "mask.sampleSize", "sample size must be positive");
  const minX = Math.floor((wx - radius - mask.origin.x) / step);
  const maxX = Math.floor((wx + radius - mask.origin.x) / step);
  const minY = Math.floor((wy - radius - mask.origin.y) / step);
  const maxY = Math.floor((wy + radius - mask.origin.y) / step);
  if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_SAMPLES_PER_DAB)
    return mutationError("terrain.mask.dab-too-large", "radius", "mask brush covers too many samples");

  const samples: MaskSample[] = [];
  for (let sy = minY; sy <= maxY; sy++) for (let sx = minX; sx <= maxX; sx++) {
    const x = mask.origin.x + (sx + 0.5) * step;
    const y = mask.origin.y + (sy + 0.5) * step;
    if (x < doc.world.bounds.minX || x >= doc.world.bounds.maxX || y < doc.world.bounds.minY || y >= doc.world.bounds.maxY) continue;
    if (Math.hypot(x - wx, y - wy) > radius + step * 0.5) continue;
    samples.push({ sx, sy });
  }
  return samples;
}

/** A frame's complete pointer path, sampled continuously and applied once. */
export function paintTerrainMaskStroke(doc: MapDocumentV5, layerId: string, points: readonly Vec2[], radius: number,
  material: MaterialRef | null, newChunkId: () => string): MutationResult {
  const found = maskLayer(doc, layerId);
  if (!found) return mutationError("terrain.mask.wrong-layer", "layerId", "expected a mask terrain layer");
  const samples = new Map<string, MaskSample>();
  for (let index = 0; index < points.length; index++) {
    const b = points[index], a = points[Math.max(0, index - 1)];
    if (![a.x, a.y, b.x, b.y, radius].every(Number.isFinite) || radius < 0)
      return mutationError("terrain.mask.bad-dab", "position", "expected finite world point and non-negative radius");
    const steps = index ? Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(.125, radius / 2))) : 0;
    if (steps > MAX_SAMPLES_PER_FILL) return mutationError("terrain.mask.stroke-too-large", "points", "stroke covers too many samples");
    for (let i = index ? 1 : 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      const collected = dabSamples(doc, found.layer.mask, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius);
      if (!Array.isArray(collected)) return collected;
      for (const sample of collected) samples.set(`${sample.sx},${sample.sy}`, sample);
      if (samples.size > MAX_SAMPLES_PER_FILL) return mutationError("terrain.mask.stroke-too-large", "points", "stroke covers too many samples");
    }
  }
  return applyMaskSamples(doc, found, [...samples.values()], material, newChunkId);
}

/** Four-connected flood fill of one painted/transparent sample region. */
export function floodTerrainMask(
  doc: MapDocumentV5,
  layerId: string,
  wx: number,
  wy: number,
  material: MaterialRef | null,
  newChunkId: () => string,
): MutationResult {
  const found = maskLayer(doc, layerId);
  if (!found) return mutationError("terrain.mask.wrong-layer", "layerId", "expected a mask terrain layer");
  if (!Number.isFinite(wx) || !Number.isFinite(wy) ||
    wx < doc.world.bounds.minX || wx >= doc.world.bounds.maxX ||
    wy < doc.world.bounds.minY || wy >= doc.world.bounds.maxY)
    return mutationError("terrain.mask.out-of-bounds", "position", "fill start is outside map bounds");
  if (material !== null && !isMaterialRef(material))
    return mutationError("terrain.mask.bad-material", "material", "expected builtin or asset material");
  const { mask } = found.layer;
  const step = mask.sampleSize;
  if (!Number.isFinite(step) || step <= 0) return mutationError("terrain.mask.bad-sample-size", "mask.sampleSize", "sample size must be positive");
  const minX = Math.ceil((doc.world.bounds.minX - mask.origin.x) / step - 0.5);
  const maxX = Math.ceil((doc.world.bounds.maxX - mask.origin.x) / step - 0.5) - 1;
  const minY = Math.ceil((doc.world.bounds.minY - mask.origin.y) / step - 0.5);
  const maxY = Math.ceil((doc.world.bounds.maxY - mask.origin.y) / step - 0.5) - 1;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const area = width * height;
  if (!Number.isSafeInteger(area) || area < 1 || area > MAX_SAMPLES_PER_FILL)
    return mutationError("terrain.mask.fill-too-large", "mask.sampleSize", "mask has too many samples for fill");
  const chunks = new Map<string, TerrainMaskChunk>();
  for (const chunk of mask.chunks) {
    if (!isPaletteIndexMaskPayload(chunk.payload, mask.materials.length))
      return mutationError("terrain.mask.unsupported-payload", "mask.chunks", "mask encoding is not supported");
    chunks.set(`${chunk.cx},${chunk.cy}`, chunk);
  }
  const at = (sx: number, sy: number): number => {
    const { cx, cy, index } = maskChunkCoords(sx, sy);
    const chunk = chunks.get(`${cx},${cy}`);
    return chunk ? (chunk.payload as { values: number[] }).values[index] : 0;
  };
  const startX = Math.floor((wx - mask.origin.x) / step);
  const startY = Math.floor((wy - mask.origin.y) / step);
  if (startX < minX || startX > maxX || startY < minY || startY > maxY)
    return mutationError("terrain.mask.out-of-bounds", "position", "fill start is outside mask samples");
  const startIndex = at(startX, startY);
  const existingIndex = material === null ? -1 : mask.materials.findIndex((entry) => sameMaterial(entry, material));
  const replacementIndex = material === null ? 0
    : existingIndex >= 0 ? existingIndex + 1 : mask.materials.length + 1;
  if (startIndex === replacementIndex) return noChange(doc);
  const visited = new Uint8Array(area);
  const queue: number[] = [];
  const push = (sx: number, sy: number) => {
    if (sx < minX || sx > maxX || sy < minY || sy > maxY) return;
    const offset = (sy - minY) * width + (sx - minX);
    if (visited[offset]) return;
    visited[offset] = 1;
    if (at(sx, sy) === startIndex) queue.push(offset);
  };
  push(startX, startY);
  const region: MaskSample[] = [];
  for (let head = 0; head < queue.length; head++) {
    const offset = queue[head];
    const sx = minX + offset % width;
    const sy = minY + Math.floor(offset / width);
    region.push({ sx, sy });
    push(sx - 1, sy);
    push(sx + 1, sy);
    push(sx, sy - 1);
    push(sx, sy + 1);
  }
  return applyMaskSamples(doc, found, region, material, newChunkId);
}
