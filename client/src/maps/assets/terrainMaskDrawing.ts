import type { RenderTerrainView } from "../renderModel";
import { MAP_ZERO, terrainEdgeTiles, terrainMaskTiles, type EdgeTile, type MapCorner, type MaskTile } from "../terrainMaskTiles";
import { terrainMaskPixel } from "../terrainMaskRaster";
import { stripImage, surfaceCells, surfaceEdge, surfaceImage, surfacePattern, type ArtPack } from "./artwork";
import { rasterDensity } from "./rasterDensity";
import { edgeAlpha, edgeNeedsPixels, edgeRamp, edgeWindow, engineNoise, type EdgeNoise, type SurfaceEdge } from "./surfaceEdge";

type Mask = NonNullable<RenderTerrainView["mask"]>;
const images = new WeakMap<MaskTile, HTMLCanvasElement>();
/** Поверхность маски в порядке наложения. Без картинки — ровный цвет с зерном. */
interface Surface { index: number; code: string; image: HTMLImageElement | null; edge: SurfaceEdge; rank: number; fill: string; noise: EdgeNoise }
interface EdgedTile { canvas: HTMLCanvasElement; tile: EdgeTile; image: HTMLImageElement | null; noise: EdgeNoise; look: string }
// Slots belong to a location/material/resolution, rather than every immutable
// paint snapshot. A changed alpha can update the same backing canvas in place.
const textures = new Map<string, EdgedTile>();
let textureBytes = 0;
const MAX_TEXTURE_BYTES = 64 * 1024 * 1024;
const patterns = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();
const recentPatterns = new Map<HTMLCanvasElement, { owner: Map<string, HTMLCanvasElement>; key: string }>();
let patternBytes = 0;

/** Сплошной кусок поверхности: цвет материала и рисунок поверх него с прозрачностью `alpha`. */
function patternTile(image: HTMLImageElement, side: number, extent: number, x: number, y: number, pack: ArtPack, fill: string, alpha: number) {
  const period = surfaceCells(image, pack);
  const phaseX = ((x % period) + period) % period, phaseY = ((y % period) + period) % period;
  const key = `${pack}:${side}:${extent}:${phaseX}:${phaseY}:${fill}:${alpha}`;
  let owner = patterns.get(image); if (!owner) { owner = new Map(); patterns.set(image, owner); }
  let canvas = owner.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
    const painter = canvas.getContext("2d"); if (!painter) return null;
    const resolution = side / extent;
    const pattern = surfacePattern(painter, image, resolution, -phaseX * resolution, -phaseY * resolution, pack); if (!pattern) return null;
    if (alpha < 1) { painter.fillStyle = fill; painter.fillRect(0, 0, side, side); painter.globalAlpha = alpha; }
    painter.fillStyle = pattern; painter.fillRect(0, 0, side, side);
    owner.set(key, canvas); recentPatterns.set(canvas, { owner, key }); patternBytes += side * side * 4;
    while (patternBytes > 64 * 1024 * 1024) {
      const [old, entry] = recentPatterns.entries().next().value!;
      recentPatterns.delete(old); patternBytes -= old.width * old.height * 4; entry.owner.delete(entry.key);
      if (old !== canvas) old.width = old.height = 0;
    }
  } else {
    const entry = recentPatterns.get(canvas)!; recentPatterns.delete(canvas); recentPatterns.set(canvas, entry);
  }
  return canvas;
}
function tileImage(tile: MaskTile) {
  let image = images.get(tile);
  if (!image) {
    const side = tile.size + 2;
    image = document.createElement("canvas"); image.width = image.height = side;
    const pen = image.getContext("2d"); if (!pen) return null;
    const pixels = pen.createImageData(side, side); pixels.data.set(tile.pixels); pen.putImageData(pixels, 0, 0);
    images.set(tile, image);
  }
  return image;
}
const small = new Map<string, HTMLCanvasElement>();
/** Картинка в один отсчёт на точку; растягивает её уже холст. */
function smallCanvas(key: string, side: number, fill: (data: Uint8ClampedArray) => void) {
  let canvas = small.get(key);
  if (canvas) { small.delete(key); small.set(key, canvas); return canvas; }
  canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
  const pen = canvas.getContext("2d"); if (!pen) return null;
  const pixels = pen.createImageData(side, side); fill(pixels.data); pen.putImageData(pixels, 0, 0);
  small.set(key, canvas);
  while (small.size > 4096) small.delete(small.keys().next().value!);
  return canvas;
}
/** Ровный цвет материала с зерном, привязанным к карте, — как у поверхности без рисунка. */
const grainTile = (tile: EdgeTile, code: string, colors: Readonly<Record<string, string>>) => {
  const side = tile.size + 2;
  return smallCanvas(`grain:${code}:${colors[code] ?? colors.plain}:${tile.size}:${tile.cx}:${tile.cy}`, side, data => {
    for (let py = 0; py < side; py++) for (let px = 0; px < side; px++) data.set(terrainMaskPixel(code, tile.cx * tile.size + px - 1, tile.cy * tile.size + py - 1, colors, true), (py * side + px) * 4);
  });
};
const fieldCanvases = new WeakMap<EdgeTile, HTMLCanvasElement>();
function fieldCanvas(tile: EdgeTile) {
  let canvas = fieldCanvases.get(tile);
  if (!canvas) {
    const side = tile.size + 2;
    canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
    const pen = canvas.getContext("2d"); if (!pen) return null;
    const pixels = pen.createImageData(side, side);
    tile.field.forEach((value, i) => { pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = value * 255; });
    pen.putImageData(pixels, 0, 0); fieldCanvases.set(tile, canvas);
  }
  return canvas;
}
const maskNoise = new WeakMap<HTMLImageElement, Map<number, EdgeNoise>>();
/** Узор кромки поверхности: своя маска, когда загрузилась, иначе шум движка. */
export function edgeNoiseOf(edge: SurfaceEdge): EdgeNoise {
  const image = edge.mask ? stripImage(edge.mask) : null, cells = edge.cells ?? 4;
  if (!image || typeof document === "undefined") return engineNoise();
  let known = maskNoise.get(image); if (!known) maskNoise.set(image, known = new Map());
  let noise = known.get(cells);
  if (!noise) {
    const side = 256, canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
    const pen = canvas.getContext("2d", { willReadFrequently: true }); if (!pen) return engineNoise();
    pen.drawImage(image, 0, 0, side, side);
    const pixels = pen.getImageData(0, 0, side, side).data;
    noise = { data: Uint8Array.from({ length: side * side }, (_, i) => pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114), side, cells };
    known.set(cells, noise);
  }
  return noise;
}

/** Плитка поверхности с её краем. Сплошная середина — готовый кусок рисунка без масок. */
function surfaceTile(tile: EdgeTile, surface: Surface, mask: Mask, pixelsPerUnit: number, pack: ArtPack, colors: Readonly<Record<string, string>>, strength: number) {
  const extent = (tile.size + 2) * mask.sampleSize, side = Math.max(1, Math.ceil(extent * pixelsPerUnit));
  const x = mask.origin.x + (tile.cx * tile.size - 1) * mask.sampleSize, y = mask.origin.y + (tile.cy * tile.size - 1) * mask.sampleSize;
  const base = surface.image ? patternTile(surface.image, side, extent, x, y, pack, surface.fill, strength) : grainTile(tile, surface.code, colors);
  if (!base || tile.solid) return base;
  const { edge, noise } = surface, look = `${surface.fill}:${strength}:${edge.width}:${edge.rough}`;
  const key = `${side}:${extent}:${x}:${y}:${pack}:${surface.code}`;
  const cached = textures.get(key);
  if (cached && cached.image === surface.image && cached.tile === tile && cached.noise === noise && cached.look === look) {
    textures.delete(key); textures.set(key, cached);
    return cached.canvas;
  }
  const canvas = cached?.canvas ?? document.createElement("canvas");
  if (!cached) canvas.width = canvas.height = side;
  const pen = canvas.getContext("2d"); if (!pen) return null;
  pen.globalCompositeOperation = "source-over"; pen.clearRect(0, 0, side, side);
  if (edgeNeedsPixels(edge, mask.sampleSize)) {
    const pixels = pen.createImageData(side, side);
    edgeAlpha(tile.field, tile.size + 2, pixels.data, side, { ramp: edgeRamp(edge, mask.sampleSize), rough: edge.rough, noise, x, y, perUnit: side / extent });
    pen.putImageData(pixels, 0, 0);
  } else {
    const alpha = fieldCanvas(tile); if (!alpha) return null;
    // Bilinear filtering is sufficient for the coarse alpha; bicubic enlargement
    // here is costly and cannot add detail to the separately sampled artwork.
    pen.imageSmoothingEnabled = true; pen.imageSmoothingQuality = "low";
    pen.drawImage(alpha, 0, 0, side, side);
  }
  pen.globalCompositeOperation = "source-in"; pen.imageSmoothingEnabled = true; pen.imageSmoothingQuality = "low";
  pen.drawImage(base, 0, 0, side, side);
  textures.delete(key); textures.set(key, { canvas, tile, image: surface.image, noise, look });
  if (!cached) textureBytes += side * side * 4;
  while (textureBytes > MAX_TEXTURE_BYTES || textures.size > 1024) {
    const [oldKey, old] = textures.entries().next().value!;
    // An individually oversized tile is returned for this draw, not retained.
    textures.delete(oldKey); textureBytes -= old.canvas.width * old.canvas.height * 4;
    if (old.canvas !== canvas) old.canvas.width = old.canvas.height = 0;
  }
  return canvas;
}

/** Only alpha/color tiles are low resolution. Artwork is sampled at screen DPR,
 * through that alpha, and never baked into a downsampled world-size bitmap.
 * С рисунками каждая поверхность кладётся отдельно, снизу вверх по ярусу, со своей кромкой; «Чертёж» — одним цветным слоем. */
export function drawTerrainMaskTiles(ctx: CanvasRenderingContext2D, mask: Mask,
  width: number, height: number, canvasW: number, canvasH: number, scale: number, ox: number, oy: number,
  pixelRatio: number, colors: Readonly<Record<string, string>>, pack: ArtPack, textured: boolean, lo: MapCorner = MAP_ZERO) {
  const viewport = { minX: -ox / scale, minY: -oy / scale, maxX: (canvasW - ox) / scale, maxY: (canvasH - oy) / scale };
  const density = mask.sampleSize * scale * pixelRatio;
  // Smaller chunks at higher screen density avoid baking large offscreen areas
  // and let a local alpha edit reuse the rest of the source chunk's artwork.
  const tileSize = 18 * density <= 256 ? 16 : 10 * density <= 256 ? 8 : 4;
  // Обрезка плитки — по целым точкам экрана: на дробной границе обе соседки сглаживают край, и сквозь шов светит бумага.
  // Граница считается одной формулой для обеих соседок, иначе округление разводит их на точку.
  const k = ctx.getTransform?.()?.a || 1, snap = (value: number) => Math.round(value * k) / k;
  const edgeX = (i: number, size: number) => snap(ox + (mask.origin.x + i * size * mask.sampleSize) * scale);
  const edgeY = (i: number, size: number) => snap(oy + (mask.origin.y + i * size * mask.sampleSize) * scale);
  const place = (image: CanvasImageSource, tile: { cx: number; cy: number; size: number }) => {
    const x = ox + (mask.origin.x + tile.cx * tile.size * mask.sampleSize) * scale;
    const y = oy + (mask.origin.y + tile.cy * tile.size * mask.sampleSize) * scale, sample = mask.sampleSize * scale;
    const x0 = edgeX(tile.cx, tile.size), y0 = edgeY(tile.cy, tile.size);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, edgeX(tile.cx + 1, tile.size) - x0, edgeY(tile.cy + 1, tile.size) - y0); ctx.clip();
    ctx.drawImage(image, x - sample, y - sample, (tile.size + 2) * sample, (tile.size + 2) * sample); ctx.restore();
  };
  ctx.save(); ctx.beginPath(); ctx.rect(ox + lo.x * scale, oy + lo.y * scale, (width - lo.x) * scale, (height - lo.y) * scale); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  if (textured && mask.source) {
    const surfaces = mask.source.codes.flatMap((code, index): Surface[] => {
      if (!code) return [];
      const image = surfaceImage(code, false, pack), fill = colors[code] ?? colors.plain ?? "#ffffff";
      // Прозрачный материал без рисунка — старая запись палитры: не рисуется и никого не подпирает.
      if (!image && terrainMaskPixel(code, 0, 0, colors)[3] === 0) return [];
      const edge = surfaceEdge(code);
      return [{ index, code, image, edge, rank: edge.tier * 1000 + index, fill, noise: edge.rough > 0 ? edgeNoiseOf(edge) : engineNoise() }];
    });
    const ranks: number[] = mask.source.codes.map(() => -Infinity);
    for (const surface of surfaces) ranks[surface.index] = surface.rank;
    const perUnit = rasterDensity(scale * pixelRatio), strength = pack === "crypt" ? 1 : .65;
    for (const surface of surfaces.sort((a, b) => a.rank - b.rank))
      for (const tile of terrainEdgeTiles(mask, width, height, viewport, surface.index, ranks, edgeWindow(surface.edge, mask.sampleSize), tileSize, lo)) {
        const image = surfaceTile(tile, surface, mask, perUnit, pack, colors, strength);
        if (image) place(image, tile);
      }
  } else for (const tile of terrainMaskTiles(mask, width, height, colors, viewport, tileSize, lo)) {
    const image = tileImage(tile);
    if (image) place(image, tile);
  }
  ctx.restore();
}
