import type { SplineNode } from "@shared/maps/core";
import type { RenderPath } from "../renderModel";
import { artworkImage } from "./artwork";
import { drawWallPolyline } from "./wallArtwork";
import { wallSegments } from "../wallGeometry";
import { rasterDensity } from "./rasterDensity";

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface WallTiles {
  key: string; image: HTMLImageElement | null; end: HTMLImageElement | null;
  paths: readonly RenderPath[]; coverage: Bounds[]; tiles: Map<string, HTMLCanvasElement>;
}
// World-anchored screen-density tiles survive camera translation. Consecutive
// walls share tiles, retaining their order without one viewport per wall.
const groups = new Map<readonly SplineNode[], Map<string, WallTiles>>();
const recent = new Map<HTMLCanvasElement, { nodes: readonly SplineNode[]; owner: WallTiles; key: string }>();
const TILE_SIZE = 512, HALO = 2, SIDE = TILE_SIZE + HALO * 2;
const MAX_BYTES = 64 * 1024 * 1024;
let bytes = 0;

export function drawCachedWalls(ctx: CanvasRenderingContext2D, paths: readonly RenderPath[],
  scale: number, ox: number, oy: number, canvasW: number, canvasH: number, pixelRatio: number) {
  const nodes = paths[0]?.nodes;
  if (!nodes) return;
  const draw = (pen: CanvasRenderingContext2D, offsetX: number, offsetY: number, drawingScale = scale, viewport?: { width: number; height: number }) => {
    for (const path of paths) if (path.nodes) drawWallPolyline(pen, path.nodes.map(node => ({ ...node.position, width: node.width })),
      path.width ?? .36, path.closed ?? false, drawingScale, offsetX, offsetY, false, viewport);
  };
  const transform = ctx.getTransform?.();
  if (!ctx.canvas || typeof document === "undefined" || !transform || transform.b || transform.c || transform.a !== pixelRatio || transform.d !== pixelRatio || !(scale > 0) || !(pixelRatio > 0)) {
    draw(ctx, ox, oy); return;
  }
  // Bake per-path opacity into the group, retaining overlaps and layer order.
  const backingDensity = rasterDensity(scale * pixelRatio), rasterScale = backingDensity / pixelRatio;
  const opacity = ctx.globalAlpha, key = `${backingDensity}:${pixelRatio}:${opacity}`;
  const image = artworkImage("wall-masonry", "crypt"), end = artworkImage("wall-masonry-end", "crypt");
  let levels = groups.get(nodes);
  const existing = levels?.values().next().value;
  if (existing && (existing.image !== image || existing.end !== end || existing.paths.length !== paths.length ||
    paths.some((path, i) => path.nodes !== existing.paths[i].nodes || path.width !== existing.paths[i].width || path.closed !== existing.paths[i].closed))) {
    for (const level of levels!.values()) for (const canvas of level.tiles.values()) {
      recent.delete(canvas); bytes -= canvas.width * canvas.height * 4; canvas.width = canvas.height = 0;
    }
    levels!.clear();
  }
  if (!levels) { levels = new Map(); groups.set(nodes, levels); }
  let cached = levels.get(key);
  if (!cached) {
    const coverage: Bounds[] = [];
    for (const path of paths) if (path.nodes) {
      const points = path.nodes.map(node => ({ ...node.position, width: node.width }));
      for (const segment of wallSegments(points, path.width ?? .36, path.closed ?? false)) {
        coverage.push({ minX: Math.min(...segment.polygon.map(p => p.x)), minY: Math.min(...segment.polygon.map(p => p.y)),
          maxX: Math.max(...segment.polygon.map(p => p.x)), maxY: Math.max(...segment.polygon.map(p => p.y)) });
      }
      if (!path.closed) for (const point of [points[0], points.at(-1)]) if (point) {
        const margin = point.width ?? path.width ?? .36;
        coverage.push({ minX: point.x - margin, minY: point.y - margin, maxX: point.x + margin, maxY: point.y + margin });
      }
    }
    cached = { key, image, end, paths, coverage, tiles: new Map() }; levels.set(key, cached);
  }
  const size = TILE_SIZE / backingDensity, halo = HALO / backingDensity;
  ctx.save(); ctx.globalAlpha = 1;
  for (let cy = Math.floor(-oy / scale / size); cy < Math.ceil((canvasH - oy) / scale / size); cy++)
    for (let cx = Math.floor(-ox / scale / size); cx < Math.ceil((canvasW - ox) / scale / size); cx++) {
      const x = cx * size, y = cy * size;
      if (!cached.coverage.some(b => b.maxX >= x - halo && b.maxY >= y - halo && b.minX <= x + size + halo && b.minY <= y + size + halo)) continue;
      const tileKey = `${cx},${cy}`;
      let canvas = cached.tiles.get(tileKey);
      if (!canvas) {
        canvas = document.createElement("canvas"); canvas.width = canvas.height = SIDE;
        const pen = canvas.getContext("2d");
        if (!pen) { ctx.restore(); draw(ctx, ox, oy); return; }
        pen.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        pen.globalAlpha = opacity;
        draw(pen, HALO / pixelRatio - x * rasterScale, HALO / pixelRatio - y * rasterScale, rasterScale, { width: SIDE / pixelRatio, height: SIDE / pixelRatio });
        cached.tiles.set(tileKey, canvas); recent.set(canvas, { nodes, owner: cached, key: tileKey }); bytes += SIDE * SIDE * 4;
        while (bytes > MAX_BYTES) {
          const [old, entry] = recent.entries().next().value!;
          recent.delete(old); bytes -= old.width * old.height * 4; entry.owner.tiles.delete(entry.key); old.width = old.height = 0;
          if (!entry.owner.tiles.size && entry.owner !== cached) {
            const oldLevels = groups.get(entry.nodes); oldLevels?.delete(entry.owner.key);
            if (!oldLevels?.size) groups.delete(entry.nodes);
          }
        }
      } else { const entry = recent.get(canvas)!; recent.delete(canvas); recent.set(canvas, entry); }
      const sx = ox + x * scale, sy = oy + y * scale, extent = size * scale, screenPixel = scale / backingDensity;
      ctx.save(); ctx.beginPath(); ctx.rect(sx, sy, extent, extent); ctx.clip();
      ctx.drawImage(canvas, sx - HALO * screenPixel, sy - HALO * screenPixel, SIDE * screenPixel, SIDE * screenPixel); ctx.restore();
    }
  ctx.restore();
}
