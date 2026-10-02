import { cartographyId } from "./cartography";
import { CRYPT_DOORS, CRYPT_SURFACES, cryptId } from "./crypt";
import { getMapImageAsset } from "./registry";
import { buildTerrainMaskRaster } from "../terrainMaskRaster";
import type { RenderTerrainView } from "../renderModel";

type Mask = NonNullable<RenderTerrainView["mask"]>;
const tiles = new WeakMap<HTMLImageElement, HTMLCanvasElement>();
const paperTiles = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

/** Feather overlapping copies on both axes; complementary masks sum to opaque paper. */
export function paperPattern(ctx: CanvasRenderingContext2D, scale: number, ox: number, oy: number) {
  const image = artworkImage("paper-panel", "crypt");
  if (!image || typeof document === "undefined") return null;
  let tile = paperTiles.get(image);
  if (!tile) {
    const size = 1024, overlap = 128, period = size - overlap;
    const feathered = document.createElement("canvas");
    feathered.width = feathered.height = size;
    const pen = feathered.getContext("2d");
    if (!pen) return null;
    pen.drawImage(image, 0, 0, size, size);
    pen.globalCompositeOperation = "destination-in";
    for (const vertical of [false, true]) {
      const mask = pen.createLinearGradient(0, 0, vertical ? 0 : size, vertical ? size : 0);
      mask.addColorStop(0, "transparent");
      mask.addColorStop(overlap / size, "#fff");
      mask.addColorStop(1 - overlap / size, "#fff");
      mask.addColorStop(1, "transparent");
      pen.fillStyle = mask;
      pen.fillRect(0, 0, size, size);
    }
    tile = document.createElement("canvas");
    tile.width = tile.height = period;
    const merged = tile.getContext("2d");
    if (!merged) return null;
    // Add premultiplied colors, avoiding dark seams from source-over alpha blending.
    merged.globalCompositeOperation = "lighter";
    for (const x of [-period, 0]) for (const y of [-period, 0]) merged.drawImage(feathered, x, y);
    paperTiles.set(image, tile);
  }
  const pattern = ctx.createPattern(tile, "repeat");
  const k = scale * 16 / tile.width;
  pattern?.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
  return pattern;
}
interface MaskArtwork { image: HTMLImageElement; canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }
const masked = new WeakMap<Mask, Map<string, MaskArtwork>>();
// History retains old masks. Bound their derived canvas memory independently.
const recentMasks = new Map<HTMLCanvasElement, { owner: Map<string, MaskArtwork>; key: string; bytes: number }>();
const MAX_MASK_CACHE_BYTES = 64 * 1024 * 1024;
let maskCacheBytes = 0;
function retainMask(owner: Map<string, MaskArtwork>, key: string, result: MaskArtwork) {
  const bytes = result.canvas.width * result.canvas.height * 4;
  recentMasks.set(result.canvas, { owner, key, bytes }); maskCacheBytes += bytes;
  while (maskCacheBytes > MAX_MASK_CACHE_BYTES || recentMasks.size > 128) {
    const oldest = recentMasks.entries().next().value!;
    recentMasks.delete(oldest[0]); maskCacheBytes -= oldest[1].bytes;
    if (oldest[1].owner.get(oldest[1].key)?.canvas === oldest[0]) oldest[1].owner.delete(oldest[1].key);
  }
}
export type ArtPack = "cartography" | "crypt";
export function artworkImage(key: string, pack: ArtPack = "cartography") { return getMapImageAsset(pack === "crypt" ? cryptId(key) : cartographyId(key))?.image ?? null; }
function mirroredTile(image: HTMLImageElement) {
  let tile = tiles.get(image);
  if (tile) return tile;
  tile = document.createElement("canvas"); tile.width = 512; tile.height = 512;
  const ctx = tile.getContext("2d")!;
  // Opposing edges match exactly. Original generated textures stay intact.
  for (const x of [0, 1]) for (const y of [0, 1]) {
    ctx.save(); ctx.translate(x ? 512 : 0, y ? 512 : 0); ctx.scale(x ? -1 : 1, y ? -1 : 1);
    ctx.drawImage(image, 0, 0, 256, 256); ctx.restore();
  }
  tiles.set(image, tile); return tile;
}
export function surfaceImage(code: string, dungeon = false, pack: ArtPack = "cartography") {
  if (pack === "crypt") return CRYPT_SURFACES[code] ? artworkImage(CRYPT_SURFACES[code], "crypt") : null;
  const key = code === "stone" || (code === "plain" && dungeon) ? "stone-floor" : ["earth", "forest", "hills", "desert"].includes(code) ? "earth" :
    ["shallow_water", "deep_water", "sea", "lake"].includes(code) ? "water" : null;
  return key ? artworkImage(key) : null;
}
/** World-anchored patterns: moving the camera never slides the artwork. */
export function surfacePattern(ctx: CanvasRenderingContext2D, image: HTMLImageElement, scale: number, ox: number, oy: number, pack: ArtPack = "cartography") {
  if (pack === "crypt" && image === artworkImage("paper-panel", "crypt")) return paperPattern(ctx, scale, ox, oy);
  // «Склеп» уже бесшовный, 2×2 клетки на файл; «Бумага и тушь» зеркалится в тайл на 8 клеток.
  const pattern = pack === "crypt" ? ctx.createPattern(image, "repeat") : ctx.createPattern(mirroredTile(image), "repeat");
  const k = pack === "crypt" ? scale * 2 / image.naturalWidth : scale * 8 / 512;
  pattern?.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
  return pattern;
}
export function texturedMask(mask: Mask, codes: readonly string[], image: HTMLImageElement, width: number, height: number, pack: ArtPack = "cartography") {
  const key = `${[...codes].sort().join(",")}:${width}:${height}`;
  const cached = masked.get(mask)?.get(key);
  if (cached?.image === image) {
    const entry = recentMasks.get(cached.canvas);
    if (entry) { recentMasks.delete(cached.canvas); recentMasks.set(cached.canvas, entry); }
    return cached;
  }
  const accepted = new Set(codes);
  const colors = Object.fromEntries(codes.map(code => [code, "#ffffff"]));
  // Keep the sparse chunk traversal; never expand the mask into cell objects.
  const filtered: Mask = mask.source ? { sampleSize: mask.sampleSize, origin: mask.origin, entries: new Map(), source: { ...mask.source, codes: mask.source.codes.map(value => value && accepted.has(value) ? value : null) } } :
    { ...mask, entries: new Map([...mask.entries].filter(([, value]) => accepted.has(value))) };
  const raster = buildTerrainMaskRaster(filtered, width, height, colors);
  if (!raster) return null;
  const alpha = document.createElement("canvas"); alpha.width = raster.width; alpha.height = raster.height;
  const alphaCtx = alpha.getContext("2d")!;
  alphaCtx.putImageData(new ImageData(new Uint8ClampedArray(raster.pixels), raster.width, raster.height), 0, 0);
  const x = mask.origin.x + raster.minSX * mask.sampleSize, y = mask.origin.y + raster.minSY * mask.sampleSize;
  const w = raster.width * mask.sampleSize, h = raster.height * mask.sampleSize;
  const pixelsPerUnit = Math.min(16, 1536 / Math.max(w, h));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.ceil(w * pixelsPerUnit)); canvas.height = Math.max(1, Math.ceil(h * pixelsPerUnit));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(alpha, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-in";
  const pattern = surfacePattern(ctx, image, pixelsPerUnit, -x * pixelsPerUnit, -y * pixelsPerUnit, pack);
  if (!pattern) return null;
  ctx.fillStyle = pattern; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const result = { image, canvas, x, y, w, h };
  let entries = masked.get(mask); if (!entries) { entries = new Map(); masked.set(mask, entries); } entries.set(key, result); retainMask(entries, key, result);
  return result;
}
let hatching: HTMLCanvasElement | null = null;
export function wallPattern(ctx: CanvasRenderingContext2D, scale: number, ox: number, oy: number) {
  if (!hatching) {
    hatching = document.createElement("canvas"); hatching.width = 32; hatching.height = 32;
    const pen = hatching.getContext("2d")!; pen.strokeStyle = "#867e69"; pen.lineWidth = 1.2;
    for (let x = -32; x < 64; x += 8) { pen.beginPath(); pen.moveTo(x, 0); pen.lineTo(x + 32, 32); pen.stroke(); }
  }
  const pattern = ctx.createPattern(hatching, "repeat");
  pattern?.setTransform(new DOMMatrix([scale / 32, 0, 0, scale / 32, ox, oy])); return pattern;
}

/** Рисунок проёма в оформлении; у «Бумаги и туши» — только обычная дверь. */
export function doorImage(kind: string, pack: ArtPack) {
  if (pack === "crypt") return CRYPT_DOORS[kind] ? artworkImage(CRYPT_DOORS[kind], "crypt") : null;
  return kind === "door" ? artworkImage("wood-door") : null;
}
