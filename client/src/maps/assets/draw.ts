import type { MapSymbolAsset } from "./registry";

// Draw in a unit square centered on the object. Canvas primitives keep the
// first offline pack synchronous in editor, thumbnails, PNG, and second screen.
export function drawMapSymbol(ctx: CanvasRenderingContext2D, asset: MapSymbolAsset): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 0.055;
  ctx.strokeStyle = "#282922";
  if (asset.glyph === "tree") {
    ctx.fillStyle = "#7c9365";
    ctx.beginPath();
    ctx.moveTo(0, -0.46);
    ctx.lineTo(0.36, 0.18);
    ctx.lineTo(0.14, 0.18);
    ctx.lineTo(0.29, 0.34);
    ctx.lineTo(-0.29, 0.34);
    ctx.lineTo(-0.14, 0.18);
    ctx.lineTo(-0.36, 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#71523d";
    ctx.fillRect(-0.055, 0.34, 0.11, 0.12);
    ctx.strokeRect(-0.055, 0.34, 0.11, 0.12);
  } else if (asset.glyph === "mountain") {
    ctx.fillStyle = "#b4a482";
    ctx.beginPath(); ctx.moveTo(-0.48, 0.4); ctx.lineTo(-0.08, -0.45);
    ctx.lineTo(0.15, -0.1); ctx.lineTo(0.28, -0.28); ctx.lineTo(0.49, 0.4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.08, -0.45); ctx.lineTo(0.02, 0.17); ctx.lineTo(0.2, 0.4); ctx.stroke();
  } else if (asset.glyph === "tower") {
    ctx.fillStyle = "#b9a68e";
    ctx.fillRect(-0.29, -0.25, 0.58, 0.68);
    ctx.strokeRect(-0.29, -0.25, 0.58, 0.68);
    for (const x of [-0.29, -0.07, 0.15]) {
      ctx.fillRect(x, -0.42, 0.14, 0.2);
      ctx.strokeRect(x, -0.42, 0.14, 0.2);
    }
    ctx.fillStyle = "#343c43";
    ctx.fillRect(-0.065, 0.12, 0.13, 0.31);
  } else {
    ctx.fillStyle = "#b87c55";
    ctx.beginPath();
    ctx.moveTo(0, -0.39);
    ctx.lineTo(0.43, 0.3);
    ctx.lineTo(-0.43, 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -0.39);
    ctx.lineTo(0, 0.3);
    ctx.stroke();
    ctx.fillStyle = "#5d433b";
    ctx.fillRect(-0.4, 0.3, 0.8, 0.08);
  }
}

const symbolBitmaps = new WeakMap<MapSymbolAsset, HTMLCanvasElement>();
/** The same vector artwork, rasterized once for dense forests and mountains. */
export function drawCachedMapSymbol(ctx: CanvasRenderingContext2D, asset: MapSymbolAsset): void {
  if (!ctx.canvas || typeof document === "undefined") { drawMapSymbol(ctx, asset); return; }
  let bitmap = symbolBitmaps.get(asset);
  if (!bitmap) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const surface = canvas.getContext("2d");
    if (!surface) { drawMapSymbol(ctx, asset); return; }
    surface.translate(128, 128); surface.scale(256 / 1.12, 256 / 1.12);
    drawMapSymbol(surface, asset); symbolBitmaps.set(asset, canvas); bitmap = canvas;
  }
  ctx.drawImage(bitmap, -0.56, -0.56, 1.12, 1.12);
}

const imageLevels = new WeakMap<HTMLImageElement, Map<number, HTMLCanvasElement>>();
const recentLevels = new Map<HTMLCanvasElement, { owner: Map<number, HTMLCanvasElement>; size: number; bytes: number }>();
let imageLevelBytes = 0;
function retainLevel(owner: Map<number, HTMLCanvasElement>, size: number, bitmap: HTMLCanvasElement) {
  const bytes = bitmap.width * bitmap.height * 4;
  recentLevels.set(bitmap, { owner, size, bytes }); imageLevelBytes += bytes;
  while (imageLevelBytes > 32 * 1024 * 1024 || recentLevels.size > 256) {
    const oldest = recentLevels.entries().next().value!;
    recentLevels.delete(oldest[0]); imageLevelBytes -= oldest[1].bytes;
    if (oldest[1].owner.get(oldest[1].size) === oldest[0]) oldest[1].owner.delete(oldest[1].size);
  }
}
/** Small props/scatter use a prefiltered level, avoiding repeated 512→12px resampling. */
export function drawCachedMapImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, displaySize: number): void {
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const target = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, displaySize))));
  let source: HTMLImageElement | HTMLCanvasElement = image;
  if (ctx.canvas && typeof document !== "undefined" && target < longest) {
    let levels = imageLevels.get(image);
    if (!levels) { levels = new Map(); imageLevels.set(image, levels); }
    let bitmap = levels.get(target);
    if (!bitmap) {
      bitmap = document.createElement("canvas");
      bitmap.width = Math.max(1, Math.round(image.naturalWidth * target / longest));
      bitmap.height = Math.max(1, Math.round(image.naturalHeight * target / longest));
      const pen = bitmap.getContext("2d");
      if (pen) {
        pen.imageSmoothingEnabled = true; pen.imageSmoothingQuality = "high";
        pen.drawImage(image, 0, 0, bitmap.width, bitmap.height); levels.set(target, bitmap); retainLevel(levels, target, bitmap);
      } else bitmap = undefined;
    }
    if (bitmap) {
      source = bitmap;
      const entry = recentLevels.get(bitmap);
      if (entry) { recentLevels.delete(bitmap); recentLevels.set(bitmap, entry); }
    }
  }
  const aspect = image.naturalWidth / image.naturalHeight;
  const w = Math.min(1, aspect), h = Math.min(1, 1 / aspect);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
}
