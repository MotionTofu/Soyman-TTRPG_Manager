import type { JsonObject } from "./json";

/** Fixed 16×16 sample chunk. Zero means the layer's default material;
 * positive values are one-based indexes into mask.materials. */
export const TERRAIN_MASK_CHUNK_SIDE = 16;
export const TERRAIN_MASK_CHUNK_AREA = TERRAIN_MASK_CHUNK_SIDE ** 2;
export const TERRAIN_MASK_ENCODING = "palette-index-v1";

export interface PaletteIndexMaskPayload extends JsonObject {
  encoding: typeof TERRAIN_MASK_ENCODING;
  values: number[];
}

export function isPaletteIndexMaskPayload(value: unknown, paletteSize: number): value is PaletteIndexMaskPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return payload.encoding === TERRAIN_MASK_ENCODING && Array.isArray(payload.values)
    && payload.values.length === TERRAIN_MASK_CHUNK_AREA
    && payload.values.every((index) => Number.isInteger(index) && index >= 0 && index <= paletteSize);
}

export function maskChunkCoords(sampleX: number, sampleY: number) {
  const cx = Math.floor(sampleX / TERRAIN_MASK_CHUNK_SIDE);
  const cy = Math.floor(sampleY / TERRAIN_MASK_CHUNK_SIDE);
  const localX = sampleX - cx * TERRAIN_MASK_CHUNK_SIDE;
  const localY = sampleY - cy * TERRAIN_MASK_CHUNK_SIDE;
  return { cx, cy, index: localY * TERRAIN_MASK_CHUNK_SIDE + localX };
}
