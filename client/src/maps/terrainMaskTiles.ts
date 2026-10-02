import type { RenderTerrainView } from "./renderModel";
import { terrainMaskPixel } from "./terrainMaskRaster";

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
const WHITE = { plain: "#ffffff" };
const chunkMaterials = new WeakMap<readonly number[], ReadonlySet<number>>();
function materialsIn(values: readonly number[]) {
  let materials = chunkMaterials.get(values);
  if (!materials) { materials = new Set(values.filter(value => value > 0)); chunkMaterials.set(values, materials); }
  return materials;
}

/** Tile interior + a one-sample halo. Neighbors preserve smoothing across seams.
 * Cache depends on immutable chunk values, including the needed halo neighbors.
 * Empty neighbor tiles allow a painted edge to fade across a chunk boundary. */
export function terrainMaskTiles(mask: Mask, width: number, height: number, colors: Readonly<Record<string, string>>,
  viewport: { minX: number; minY: number; maxX: number; maxY: number }, accepted?: readonly string[], tileSize: 4 | 8 | 16 = 16): MaskTile[] {
  if (!mask.source || !(mask.sampleSize > 0)) return [];
  const size = mask.sampleSize, index = indexOf(mask), tiles: MaskTile[] = [];
  const filter = accepted ? new Set(accepted) : null, palette = accepted ? WHITE : colors;
  const allowed = new Set(mask.source.codes.flatMap((code, i) => code && (filter ? filter.has(code) : terrainMaskPixel(code, 0, 0, palette, true)[3] > 0) ? [i + 1] : []));
  if (!allowed.size) return [];
  const signature = `${tileSize}:${width}:${height}:${size}:${mask.origin.x}:${mask.origin.y}:${JSON.stringify(mask.source.codes)}:${JSON.stringify(palette)}:${accepted ? [...accepted].sort().join(",") : "color"}`;
  const minSX = Math.ceil(-mask.origin.x / size - .5), maxSX = Math.ceil((width - mask.origin.x) / size - .5) - 1;
  const minSY = Math.ceil(-mask.origin.y / size - .5), maxSY = Math.ceil((height - mask.origin.y) / size - .5) - 1;
  const candidates = new Set<string>();
  for (const chunk of mask.source.chunks) {
    // Historical palette entries and transparent color groups must not fill
    // the cache with empty tiles from every unrelated painted chunk.
    if (![...materialsIn(chunk.values)].some(material => allowed.has(material))) continue;
    for (let cy = Math.floor((chunk.cy * 16 - 1) / tileSize); cy <= Math.floor((chunk.cy * 16 + 16) / tileSize); cy++)
      for (let cx = Math.floor((chunk.cx * 16 - 1) / tileSize); cx <= Math.floor((chunk.cx * 16 + 16) / tileSize); cx++) {
        const x = mask.origin.x + cx * tileSize * size, y = mask.origin.y + cy * tileSize * size;
        if (x >= Math.min(width, viewport.maxX) || y >= Math.min(height, viewport.maxY) || x + tileSize * size <= Math.max(0, viewport.minX) || y + tileSize * size <= Math.max(0, viewport.minY)) continue;
        candidates.add(`${cx},${cy}`);
      }
  }
  for (const cell of candidates) {
    const [cx, cy] = cell.split(",").map(Number), neighbors: CachedTile["neighbors"] = [];
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
      if (!code || filter && !filter.has(code)) continue;
      const pixel = terrainMaskPixel(code, sx, sy, palette, !filter);
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
