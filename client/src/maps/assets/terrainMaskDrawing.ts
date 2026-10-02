import type { RenderTerrainView } from "../renderModel";
import { terrainMaskTiles, type MaskTile } from "../terrainMaskTiles";
import { artworkImage, surfaceImage, surfacePattern, type ArtPack } from "./artwork";

const images = new WeakMap<MaskTile, HTMLCanvasElement>();
const opaqueTiles = new WeakMap<MaskTile, boolean>();
interface TextureTile { canvas: HTMLCanvasElement; image: HTMLImageElement; tile: MaskTile }
// Slots belong to a location/material/resolution, rather than every immutable
// paint snapshot. A changed alpha can update the same backing canvas in place.
const textures = new Map<string, TextureTile>();
let textureBytes = 0;
const MAX_TEXTURE_BYTES = 64 * 1024 * 1024;
const patterns = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();
const recentPatterns = new Map<HTMLCanvasElement, { owner: Map<string, HTMLCanvasElement>; key: string }>();
let patternBytes = 0;

function patternTile(image: HTMLImageElement, side: number, extent: number, x: number, y: number, pack: ArtPack) {
  const paper = pack === "crypt" && image === artworkImage("paper-panel", "crypt");
  const period = pack === "crypt" ? paper ? 16 : 2 : 8;
  const phaseX = ((x % period) + period) % period, phaseY = ((y % period) + period) % period;
  const key = `${pack}:${side}:${extent}:${phaseX}:${phaseY}`;
  let owner = patterns.get(image); if (!owner) { owner = new Map(); patterns.set(image, owner); }
  let canvas = owner.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
    const painter = canvas.getContext("2d"); if (!painter) return null;
    const resolution = side / extent;
    const pattern = surfacePattern(painter, image, resolution, -phaseX * resolution, -phaseY * resolution, pack); if (!pattern) return null;
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

function texturedTile(tile: MaskTile, image: HTMLImageElement, mask: NonNullable<RenderTerrainView["mask"]>, pixelsPerUnit: number, pack: ArtPack, codes: readonly string[]) {
  const extent = (tile.size + 2) * mask.sampleSize, side = Math.max(1, Math.ceil(extent * pixelsPerUnit));
  const x = mask.origin.x + (tile.cx * tile.size - 1) * mask.sampleSize, y = mask.origin.y + (tile.cy * tile.size - 1) * mask.sampleSize;
  let opaque = opaqueTiles.get(tile);
  if (opaque === undefined) { opaque = tile.pixels.every((value, i) => i % 4 !== 3 || value === 255); opaqueTiles.set(tile, opaque); }
  // Fully painted interiors need no alpha enlargement or compositing at all.
  if (opaque) return patternTile(image, side, extent, x, y, pack);
  const key = `${side}:${extent}:${x}:${y}:${pack}:${codes.join(",")}`;
  const cached = textures.get(key);
  if (cached?.image === image && cached.tile === tile) {
    textures.delete(key); textures.set(key, cached);
    return cached.canvas;
  }
  const alpha = tileImage(tile); if (!alpha) return null;
  const canvas = cached?.canvas ?? document.createElement("canvas");
  if (!cached) canvas.width = canvas.height = side;
  const pen = canvas.getContext("2d"); if (!pen) return null;
  pen.globalCompositeOperation = "source-over"; pen.clearRect(0, 0, side, side);
  // Bilinear filtering is sufficient for the coarse alpha; bicubic enlargement
  // here is costly and cannot add detail to the separately sampled artwork.
  pen.imageSmoothingEnabled = true; pen.imageSmoothingQuality = "low";
  pen.drawImage(alpha, 0, 0, side, side); pen.globalCompositeOperation = "source-in";
  const pattern = patternTile(image, side, extent, x, y, pack);
  if (!pattern) return null;
  pen.drawImage(pattern, 0, 0);
  textures.delete(key); textures.set(key, { canvas, image, tile });
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
 * through that alpha, and never baked into a downsampled world-size bitmap. */
export function drawTerrainMaskTiles(ctx: CanvasRenderingContext2D, mask: NonNullable<RenderTerrainView["mask"]>,
  width: number, height: number, canvasW: number, canvasH: number, scale: number, ox: number, oy: number,
  pixelRatio: number, colors: Readonly<Record<string, string>>, pack: ArtPack, textured: boolean) {
  const viewport = { minX: -ox / scale, minY: -oy / scale, maxX: (canvasW - ox) / scale, maxY: (canvasH - oy) / scale };
  const density = mask.sampleSize * scale * pixelRatio;
  // Smaller chunks at higher screen density avoid baking large offscreen areas
  // and let a local alpha edit reuse the rest of the source chunk's artwork.
  const tileSize = 18 * density <= 256 ? 16 : 10 * density <= 256 ? 8 : 4;
  const paintTiles = (pen: CanvasRenderingContext2D, accepted?: readonly string[], artwork?: HTMLImageElement) => {
    for (const tile of terrainMaskTiles(mask, width, height, colors, viewport, accepted, tileSize)) {
      const image = artwork ? texturedTile(tile, artwork, mask, scale * pixelRatio, pack, accepted!) : tileImage(tile); if (!image) continue;
      const x = ox + (mask.origin.x + tile.cx * tile.size * mask.sampleSize) * scale;
      const y = oy + (mask.origin.y + tile.cy * tile.size * mask.sampleSize) * scale, sample = mask.sampleSize * scale;
      pen.save(); pen.beginPath(); pen.rect(x, y, tile.size * sample, tile.size * sample); pen.clip();
      pen.drawImage(image, x - sample, y - sample, (tile.size + 2) * sample, (tile.size + 2) * sample); pen.restore();
    }
  };
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, width * scale, height * scale); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  paintTiles(ctx);
  if (textured && mask.source) {
    const byImage = new Map<HTMLImageElement, string[]>();
    for (const code of new Set(mask.source.codes)) {
      if (!code) continue; const image = surfaceImage(code, false, pack); if (!image) continue;
      const codes = byImage.get(image) ?? []; codes.push(code); byImage.set(image, codes);
    }
    for (const [image, codes] of byImage) {
      ctx.save(); ctx.globalAlpha *= pack === "crypt" ? 1 : .65;
      paintTiles(ctx, codes, image); ctx.restore();
    }
  }
  ctx.restore();
}
