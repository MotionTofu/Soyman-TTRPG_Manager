import { cartographyId } from "./cartography";
import { CRYPT_DOORS, CRYPT_SURFACES, cryptId } from "./crypt";
import { getMapImageAsset, loadMapImageAsset } from "./registry";
import { villageId, villageSurfaceKey, waterLevel } from "./village";
import { worldId, worldSurfaceEdge, worldSurfaceKey } from "./world";
import { PLAIN_EDGE, type SurfaceEdge } from "./surfaceEdge";
import { ownSurface } from "./ownPacks";
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
/** Поверхности «Местности»: образец на 4×4 клетки, уже бесшовный. */
const villageImages = new WeakSet<HTMLImageElement>();
/** Образцы поверхностей своих наборов: бесшовные, период — сколько клеток задал Мастер. */
const ownImages = new WeakMap<HTMLImageElement, number>();
/** Сколько клеток покрывает один повтор картинки поверхности. */
export const surfaceCells = (image: HTMLImageElement, pack: ArtPack) =>
  ownImages.get(image) ?? (villageImages.has(image) ? 4 : pack !== "crypt" ? 8 : image === artworkImage("paper-panel", "crypt") ? 16 : 2);
export function surfaceImage(code: string, dungeon = false, pack: ArtPack = "cartography") {
  const own = ownSurface(code);
  if (own) {
    // Грузит карта (`prepareMapImageAssets`) и каталог; здесь только читаем готовое.
    const image = getMapImageAsset(own.assetId)?.image ?? null;
    if (image) ownImages.set(image, own.cells);
    return image;
  }
  const world = worldSurfaceKey(code), village = world ? null : villageSurfaceKey(code);
  if (village || world) {
    // Материал, а не оформление: рисуется при любом стиле и грузится по первому обращению.
    const asset = getMapImageAsset(world ? worldId(world) : villageId(village!));
    if (asset && !asset.image && !asset.failed) void loadMapImageAsset(asset.id).catch(() => undefined);
    if (asset?.image) villageImages.add(asset.image);
    return asset?.image ?? null;
  }
  if (pack === "crypt") return CRYPT_SURFACES[code] ? artworkImage(CRYPT_SURFACES[code], "crypt") : null;
  const key = code === "stone" || (code === "plain" && dungeon) ? "stone-floor" : ["earth", "forest", "hills", "desert"].includes(code) ? "earth" :
    ["shallow_water", "deep_water", "sea", "lake"].includes(code) ? "water" : null;
  return key ? artworkImage(key) : null;
}
/** Кромки встроенных поверхностей «Деревни» (подобраны 2026-10-08): трава и брусчатка лежат клочьями, земля под ними — ровно. */
const VILLAGE_EDGES: Readonly<Record<string, SurfaceEdge>> = {
  grass: { width: 0.6, rough: 0.7, tier: 1 }, field: { width: 0.35, rough: 0.35, tier: 1 }, cobbles: { width: 0.35, rough: 0.6, tier: 2 },
  mud: { width: 0.5, rough: 0.45, tier: 0 }, sand: { width: 0.5, rough: 0.4, tier: 0 }, bog: { width: 0.5, rough: 0.5, tier: 0 },
};
/** Ярусы общих материалов: вода и голая земля внизу, растительность посередине, камень, дерево и дорога сверху. */
const TIERS: Readonly<Record<string, SurfaceEdge>> = Object.fromEntries([[0, ["plain", "earth", "desert", "swamp", "lava", "acid", "poison", "ice"]], [2, ["stone", "wood", "road", "mountains"]]]
  .flatMap(([tier, codes]) => (codes as string[]).map(code => [code, { ...PLAIN_EDGE, tier: tier as number }])));
const LIQUID_EDGE: SurfaceEdge = { ...PLAIN_EDGE, tier: 0 };
/** Кромка и ярус поверхности по коду материала. Жидкости — всегда внизу: их край рисует сама вода. */
export function surfaceEdge(code: string): SurfaceEdge {
  const own = ownSurface(code);
  if (own) return own.edge;
  if (waterLevel(code)) return LIQUID_EDGE;
  const world = worldSurfaceKey(code);
  if (world) return worldSurfaceEdge(world)!;
  const village = villageSurfaceKey(code);
  return village ? VILLAGE_EDGES[village.replace(/-\d+$/, "")] ?? LIQUID_EDGE : TIERS[code] ?? PLAIN_EDGE;
}
/** Полоса дороги по id ассета; пока картинка грузится — `null`, линия рисуется тушью. */
export function stripImage(assetId: string) {
  const asset = getMapImageAsset(assetId);
  if (asset && !asset.image && !asset.failed) void loadMapImageAsset(asset.id).catch(() => undefined);
  return asset?.image ?? null;
}
const mips = new WeakMap<HTMLImageElement, HTMLCanvasElement[]>();
/** Источник узора под масштаб `k` (экранных пикселей на пиксель картинки). Узор прямо
 * из картинки браузер готовит заново на каждый новый масштаб: замер 2026-10-07 — до
 * 330 мс на плитку 256 px, с готовыми копиями — до 90. Копии уменьшаются вдвое, пока
 * стороны чётные, чтобы шов узора не сдвигался; берётся ближайшая не меньше нужной.
 * `factor` — во сколько раз копия меньше картинки: на него умножается масштаб узора. */
export function patternSource(image: HTMLImageElement, k: number): { source: HTMLImageElement | HTMLCanvasElement; factor: number } {
  let chain = mips.get(image);
  if (!chain) {
    const full = document.createElement("canvas"); full.width = image.naturalWidth; full.height = image.naturalHeight;
    const pen = full.getContext("2d");
    if (!pen || !full.width || !full.height) return { source: image, factor: 1 };
    pen.drawImage(image, 0, 0); chain = [full]; mips.set(image, chain);
  }
  const level = k > 0 && k < 1 ? Math.floor(Math.log2(1 / k)) : 0;
  while (chain.length <= level) {
    const last = chain.at(-1)!;
    if (last.width % 2 || last.height % 2 || last.width <= 16 || last.height <= 16) break;
    const half = document.createElement("canvas"); half.width = last.width / 2; half.height = last.height / 2;
    const pen = half.getContext("2d")!; pen.imageSmoothingEnabled = true; pen.imageSmoothingQuality = "high";
    pen.drawImage(last, 0, 0, half.width, half.height); chain.push(half);
  }
  const source = chain[Math.min(level, chain.length - 1)];
  return { source, factor: image.naturalWidth / source.width };
}
/** World-anchored patterns: moving the camera never slides the artwork. */
export function surfacePattern(ctx: CanvasRenderingContext2D, image: HTMLImageElement, scale: number, ox: number, oy: number, pack: ArtPack = "cartography") {
  if (pack === "crypt" && image === artworkImage("paper-panel", "crypt")) return paperPattern(ctx, scale, ox, oy);
  // «Склеп» и «Местность» уже бесшовные; «Бумага и тушь» зеркалится в тайл на 8 клеток.
  const seamless = pack === "crypt" || villageImages.has(image) || ownImages.has(image);
  const size = seamless ? scale * surfaceCells(image, pack) / image.naturalWidth : scale * 8 / 512;
  const { source, factor } = seamless ? patternSource(image, size) : { source: mirroredTile(image), factor: 1 };
  const pattern = ctx.createPattern(source, "repeat"), k = size * factor;
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
