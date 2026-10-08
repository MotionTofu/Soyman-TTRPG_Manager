import type { RenderTerrainView } from "./renderModel";
import { terrainMaskPixel } from "./terrainMaskRaster";
import { edgeField, edgeMargin } from "./assets/surfaceEdge";

type Mask = NonNullable<RenderTerrainView["mask"]>;
type Chunk = NonNullable<Mask["source"]>["chunks"][number];
export interface MaskTile { cx: number; cy: number; size: number; pixels: Uint8ClampedArray }
const indexes = new WeakMap<Mask, Map<string, Chunk>>();
function indexOf(mask: Mask) {
  let index = indexes.get(mask);
  if (!index) { index = new Map(mask.source?.chunks.map(chunk => [`${chunk.cx},${chunk.cy}`, chunk])); indexes.set(mask, index); }
  return index;
}
export function maskSampleCode(mask: Mask, sx: number, sy: number) {
  if (!mask.source) return mask.entries.get(`${sx},${sy}`);
  const cx = Math.floor(sx / 16), cy = Math.floor(sy / 16), chunk = indexOf(mask).get(`${cx},${cy}`);
  return chunk ? mask.source.codes[chunk.values[(sy - cy * 16) * 16 + sx - cx * 16] - 1] : undefined;
}

interface CachedTile { neighbors: (readonly number[] | undefined)[]; tile: MaskTile | null }
const cached = new Map<string, CachedTile>();
const MAX_TILES = 8192; // At most ~10 MiB of pixels, usually much smaller tiles.
type Candidate = { cell: string; cx: number; cy: number; x: number; y: number };
const candidateCache = new WeakMap<Mask, Map<string, Candidate[]>>();
const chunkMaterials = new WeakMap<readonly number[], ReadonlySet<number>>();
function materialsIn(values: readonly number[]) {
  let materials = chunkMaterials.get(values);
  if (!materials) { materials = new Set(values.filter(value => value > 0)); chunkMaterials.set(values, materials); }
  return materials;
}

/** Плитки, которых касаются куски маски с материалами `allowed`, с запасом `margin` отсчётов.
 * Карта рисуется плитками, и для каждой сюда приходят по разу на каждый материал. Перебор всех кусков маски —
 * один раз на маску и материал, дальше только отсев по экрану (замер 2026-10-08: 2,4 мс на плитку карты уходило на этот перебор). */
function candidatesFor(mask: Mask, signature: string, allowed: () => ReadonlySet<number>, margin: number, tileSize: number, width: number, height: number) {
  let known = candidateCache.get(mask); if (!known) candidateCache.set(mask, known = new Map());
  let candidates = known.get(signature);
  if (!candidates) {
    const wanted = allowed(), size = mask.sampleSize, cells = new Map<string, Candidate>();
    if (wanted.size) for (const chunk of mask.source!.chunks) {
      // Historical palette entries and transparent color groups must not fill
      // the cache with empty tiles from every unrelated painted chunk.
      if (![...materialsIn(chunk.values)].some(material => wanted.has(material))) continue;
      for (let cy = Math.floor((chunk.cy * 16 - margin) / tileSize); cy <= Math.floor((chunk.cy * 16 + 15 + margin) / tileSize); cy++)
        for (let cx = Math.floor((chunk.cx * 16 - margin) / tileSize); cx <= Math.floor((chunk.cx * 16 + 15 + margin) / tileSize); cx++) {
          const x = mask.origin.x + cx * tileSize * size, y = mask.origin.y + cy * tileSize * size;
          if (x >= width || y >= height || x + tileSize * size <= 0 || y + tileSize * size <= 0) continue;
          cells.set(`${cx},${cy}`, { cell: `${cx},${cy}`, cx, cy, x, y });
        }
    }
    known.set(signature, candidates = [...cells.values()]);
  }
  return candidates;
}

/** Плитка одной поверхности: поле покрытия `(size + 2)²` отсчётов с каймой в один отсчёт. `solid` — закрашена целиком. */
export interface EdgeTile { cx: number; cy: number; size: number; field: Float32Array; solid: boolean }
const edgeCached = new Map<string, { neighbors: (readonly number[] | undefined)[]; tile: EdgeTile | null }>();
/** Плитки материала номер `index` из палитры маски. `ranks` — порядок наложения материалов палитры (−∞ — не рисуется):
 * под теми, что выше, поверхность продолжается. `window` — окно размытия края в отсчётах. */
export function terrainEdgeTiles(mask: Mask, width: number, height: number, viewport: { minX: number; minY: number; maxX: number; maxY: number },
  index: number, ranks: readonly number[], window: number, tileSize: 4 | 8 | 16 = 16): EdgeTile[] {
  if (!mask.source || !(mask.sampleSize > 0)) return [];
  const size = mask.sampleSize, chunks = indexOf(mask), tiles: EdgeTile[] = [], margin = edgeMargin(window) + 1, rank = ranks[index];
  const signature = `${tileSize}:${width}:${height}:${size}:${mask.origin.x}:${mask.origin.y}:edge:${index}:${window}:${ranks.join(",")}`;
  const minSX = Math.ceil(-mask.origin.x / size - .5), maxSX = Math.ceil((width - mask.origin.x) / size - .5) - 1;
  const minSY = Math.ceil(-mask.origin.y / size - .5), maxSY = Math.ceil((height - mask.origin.y) / size - .5) - 1;
  const clampX = (sx: number) => Math.max(minSX, Math.min(maxSX, sx)), clampY = (sy: number) => Math.max(minSY, Math.min(maxSY, sy));
  let lastKey = "", last: Chunk | undefined;
  const rankAt = (sx: number, sy: number) => {
    const x = clampX(sx), y = clampY(sy), cx = Math.floor(x / 16), cy = Math.floor(y / 16), key = `${cx},${cy}`;
    if (key !== lastKey) { lastKey = key; last = chunks.get(key); }
    const value = last?.values[(y - cy * 16) * 16 + x - cx * 16];
    return value ? ranks[value - 1] : -Infinity;
  };
  for (const { cell, cx, cy, x, y } of candidatesFor(mask, signature, () => new Set([index + 1]), margin, tileSize, width, height)) {
    if (x >= viewport.maxX || y >= viewport.maxY || x + tileSize * size <= viewport.minX || y + tileSize * size <= viewport.minY) continue;
    const neighbors: (readonly number[] | undefined)[] = [];
    for (let ny = Math.floor(clampY(cy * tileSize - margin) / 16); ny <= Math.floor(clampY((cy + 1) * tileSize + margin) / 16); ny++)
      for (let nx = Math.floor(clampX(cx * tileSize - margin) / 16); nx <= Math.floor(clampX((cx + 1) * tileSize + margin) / 16); nx++) neighbors.push(chunks.get(`${nx},${ny}`)?.values);
    const key = `${cell}:${signature}`, previous = edgeCached.get(key);
    if (previous && previous.neighbors.every((value, i) => value === neighbors[i])) {
      edgeCached.delete(key); edgeCached.set(key, previous); if (previous.tile) tiles.push(previous.tile); continue;
    }
    const field = edgeField(tileSize + 2, cx * tileSize - 1, cy * tileSize - 1, rankAt, rank, window);
    // Правка соседа не обязана менять край этой плитки: прежняя плитка сохраняет и готовую картинку.
    const tile = !field.some(value => value > 0) ? null : previous?.tile && field.every((value, i) => value === previous.tile!.field[i])
      ? previous.tile : { cx, cy, size: tileSize, field, solid: field.every(value => value === 1) };
    edgeCached.delete(key); edgeCached.set(key, { neighbors, tile }); if (tile) tiles.push(tile);
    while (edgeCached.size > MAX_TILES) edgeCached.delete(edgeCached.keys().next().value!);
  }
  return tiles;
}

/** Tile interior + a one-sample halo. Neighbors preserve smoothing across seams.
 * Cache depends on immutable chunk values, including the needed halo neighbors.
 * Empty neighbor tiles allow a painted edge to fade across a chunk boundary. */
export function terrainMaskTiles(mask: Mask, width: number, height: number, colors: Readonly<Record<string, string>>,
  viewport: { minX: number; minY: number; maxX: number; maxY: number }, tileSize: 4 | 8 | 16 = 16): MaskTile[] {
  if (!mask.source || !(mask.sampleSize > 0)) return [];
  const size = mask.sampleSize, index = indexOf(mask), tiles: MaskTile[] = [];
  const palette = colors;
  const signature = `${tileSize}:${width}:${height}:${size}:${mask.origin.x}:${mask.origin.y}:${JSON.stringify(mask.source.codes)}:${JSON.stringify(palette)}:color`;
  const minSX = Math.ceil(-mask.origin.x / size - .5), maxSX = Math.ceil((width - mask.origin.x) / size - .5) - 1;
  const minSY = Math.ceil(-mask.origin.y / size - .5), maxSY = Math.ceil((height - mask.origin.y) / size - .5) - 1;
  const candidates = candidatesFor(mask, signature, () => new Set(mask.source!.codes.flatMap((code, i) => code && terrainMaskPixel(code, 0, 0, palette, true)[3] > 0 ? [i + 1] : [])), 1, tileSize, width, height);
  for (const { cell, cx, cy, x, y } of candidates) {
    if (x >= viewport.maxX || y >= viewport.maxY || x + tileSize * size <= viewport.minX || y + tileSize * size <= viewport.minY) continue;
    const neighbors: CachedTile["neighbors"] = [];
    const clampX = (sx: number) => Math.max(minSX, Math.min(maxSX, sx)), clampY = (sy: number) => Math.max(minSY, Math.min(maxSY, sy));
    for (let ny = Math.floor(clampY(cy * tileSize - 1) / 16); ny <= Math.floor(clampY((cy + 1) * tileSize) / 16); ny++)
      for (let nx = Math.floor(clampX(cx * tileSize - 1) / 16); nx <= Math.floor(clampX((cx + 1) * tileSize) / 16); nx++) neighbors.push(index.get(`${nx},${ny}`)?.values);
    const key = `${cell}:${signature}`, previous = cached.get(key);
    if (previous && previous.neighbors.every((value, i) => value === neighbors[i])) {
      cached.delete(key); cached.set(key, previous); if (previous.tile) tiles.push(previous.tile); continue;
    }
    const side = tileSize + 2, pixels = new Uint8ClampedArray(side * side * 4); let painted = false;
    for (let py = 0; py < side; py++) for (let px = 0; px < side; px++) {
      const sx = clampX(cx * tileSize + px - 1);
      const sy = clampY(cy * tileSize + py - 1);
      const code = maskSampleCode(mask, sx, sy);
      if (!code) continue;
      const pixel = terrainMaskPixel(code, sx, sy, palette, true);
      pixels.set(pixel, (py * side + px) * 4); if (pixel[3]) painted = true;
    }
    // A changed neighbor/material need not change this tile's actual alpha.
    // Preserve its identity so unrelated texture groups stay cached as well.
    const tile = painted ? previous?.tile && pixels.every((value, i) => value === previous.tile!.pixels[i])
      ? previous.tile : { cx, cy, size: tileSize, pixels } : null;
    cached.delete(key); cached.set(key, { neighbors, tile }); if (tile) tiles.push(tile);
    while (cached.size > MAX_TILES) cached.delete(cached.keys().next().value!);
  }
  return tiles;
}
