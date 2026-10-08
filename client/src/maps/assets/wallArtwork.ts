import type { Vec2 } from "@shared/maps/core";
import { wallSegments } from "../wallGeometry";
import { artworkImage, patternSource } from "./artwork";

const segmentCache = new WeakMap<readonly Vec2[], { width: number; closed: boolean; count: number; segments: ReturnType<typeof wallSegments> }>();
/** Each segment owns a polygon; adjacent textures share the same joint boundary. */
export function drawWallPolyline(ctx: CanvasRenderingContext2D, points: readonly (Vec2 & { width?: number })[], width: number, closed: boolean,
  scale: number, ox: number, oy: number, selected = false, viewport?: { width: number; height: number }, strip?: HTMLImageElement, core = 0) {
  // Один и тот же массив точек приходит для каждой плитки карты: геометрию отрезков считаем один раз.
  let known = segmentCache.get(points);
  if (!known || known.width !== width || known.closed !== closed || known.count !== points.length) segmentCache.set(points, known = { width, closed, count: points.length, segments: wallSegments(points, width, closed) });
  const segments = known.segments;
  if (!segments.length) return;
  // `strip` — своя полоса вместо кладки (дорога): без торцов, рисунок идёт вдоль всей линии без сброса на изломах.
  const image = strip ?? artworkImage("wall-masonry", "crypt"), end = strip ? null : artworkImage("wall-masonry-end", "crypt");
  let run = 0;
  // Узор берётся из готовой уменьшенной копии; `factor` возвращает ему прежний размер.
  const { source, factor } = image ? patternSource(image, width * scale / image.naturalHeight) : { source: null, factor: 1 };
  const pattern = source ? ctx.createPattern(source, "repeat-x") : null;
  const textureScale = width * scale / (image?.naturalHeight ?? 128) * factor;
  const X = (x: number) => ox + x * scale, Y = (y: number) => oy + y * scale;
  for (const segment of segments) {
    const phase = strip ? -run * scale : 0;
    run += segment.length;
    if (viewport && (segment.polygon.every(p => X(p.x) < 0) || segment.polygon.every(p => X(p.x) > viewport.width) ||
      segment.polygon.every(p => Y(p.y) < 0) || segment.polygon.every(p => Y(p.y) > viewport.height))) continue;
    ctx.save(); ctx.beginPath();
    segment.polygon.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
    ctx.closePath(); ctx.clip();
    ctx.translate(X(segment.a.x), Y(segment.a.y)); ctx.rotate(segment.angle);
    const thickness = Math.max(segment.startWidth, segment.endWidth) * scale;
    if (pattern && image) {
      // Полоса дороги уже разбита на отрезки по ~10 px: сужение внутри отрезка незаметно, а его край задаёт обрезка.
      // Рисовать её тонкими полосками, как клин стены, — тысячи заливок на плитку (замер 2026-10-08: 3 мс).
      if (segment.startWidth === segment.endWidth || strip) {
        const mean = (segment.startWidth + segment.endWidth) / 2, k = mean * scale / image.naturalHeight * factor;
        pattern.setTransform(new DOMMatrix([textureScale, 0, 0, k, phase, -mean * scale / 2])); ctx.fillStyle = pattern;
        // `core` — только середина полосы, без рваных краёв: ею дороги закрывают края друг друга на перекрёстке.
        if (core) ctx.fillRect(-thickness * 2, -mean * scale * core / 2, segment.length * scale + thickness * 4, mean * scale * core);
        else ctx.fillRect(-thickness * 2, -thickness * 2, segment.length * scale + thickness * 4, thickness * 4);
      } else {
        // Narrow screen-space strips stretch the raster vertically across the taper; X phase stays continuous.
        const left = -thickness * 2, right = segment.length * scale + thickness * 2;
        const steps = Math.min(2048, Math.max(1, Math.ceil((right - left) / 2)));
        const step = (right - left) / steps;
        let firstStrip = 0, lastStrip = steps;
        if (viewport) {
          // A long wall may cross many raster tiles. Keep the original strip
          // boundaries/texture phase, but submit only strips reaching this tile.
          const cos = Math.cos(segment.angle), sin = Math.sin(segment.angle);
          const start = -X(segment.a.x) * cos - Y(segment.a.y) * sin;
          const xs = [start, start + viewport.width * cos, start + viewport.height * sin,
            start + viewport.width * cos + viewport.height * sin];
          firstStrip = Math.max(0, Math.floor((Math.min(...xs) - left - .25) / step));
          lastStrip = Math.min(steps, Math.ceil((Math.max(...xs) - left) / step));
        }
        for (let i = firstStrip; i < lastStrip; i++) {
          const x = left + i * step, t = Math.max(0, Math.min(1, (x + step / 2) / (segment.length * scale)));
          const h = (segment.startWidth + (segment.endWidth - segment.startWidth) * t) * scale;
          pattern.setTransform(new DOMMatrix([textureScale, 0, 0, h / image.naturalHeight * factor, phase, -h / 2])); ctx.fillStyle = pattern;
          ctx.fillRect(x, -thickness * 2, step + .25, thickness * 4);
        }
      }
    } else { ctx.fillStyle = "#a49678"; ctx.fillRect(-thickness * 2, -thickness * 2, segment.length * scale + thickness * 4, thickness * 4); }
    ctx.restore();
  }
  if (!closed && end) {
    const first = segments[0], last = segments.at(-1)!;
    for (const cap of [{ position: first.a, angle: first.angle + Math.PI, width: first.startWidth }, { position: last.b, angle: last.angle, width: last.endWidth }]) {
      ctx.save(); ctx.translate(X(cap.position.x), Y(cap.position.y)); ctx.rotate(cap.angle);
      // The installed 256px sheet contains two caps. Use one, excluding its transparent margins.
      const thickness = cap.width * scale;
      const capWidth = thickness * 106 / 116;
      ctx.drawImage(end, 10, 70, 106, 116, -capWidth / 2, -thickness / 2, capWidth, thickness); ctx.restore();
    }
  }
  if (selected) {
    ctx.save(); ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 2; ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
    if (closed) ctx.closePath(); ctx.stroke(); ctx.restore();
  }
}
