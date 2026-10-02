import type { Vec2 } from "@shared/maps/core";

export function wallPoints(points: readonly (Vec2 & { width?: number })[], closed = false) {
  const clean = points.filter((p, i) => !i || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-6).map(p => ({ ...p }));
  if (closed && clean.length > 1 && Math.hypot(clean[0].x - clean.at(-1)!.x, clean[0].y - clean.at(-1)!.y) < 1e-6) clean.pop();
  return clean;
}
export function wallSegments(input: readonly (Vec2 & { width?: number })[], width: number, closed: boolean) {
  const points = wallPoints(input, closed);
  if (points.length < (closed ? 3 : 2) || !Number.isFinite(width) || width <= 0) return [];
  const count = closed ? points.length : points.length - 1;
  const tangents = Array.from({ length: count }, (_, i) => {
    const a = points[i], b = points[(i + 1) % points.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length, length };
  });
  const joins = points.map((point, i) => {
    const localWidth = points[i].width ?? width, half = localWidth / 2;
    const before = tangents[(i - 1 + count) % count], after = tangents[i % count];
    let offset: Vec2, bevel = false;
    if (!closed && (i === 0 || i === points.length - 1)) {
      const t = i === 0 ? after : before;
      offset = { x: -t.y * half, y: t.x * half };
    } else {
      const nx = -before.y - after.y, ny = before.x + after.x;
      const length = Math.hypot(nx, ny);
      if (length < 1e-6) offset = { x: -after.y * half, y: after.x * half };
      else {
        const x = nx / length, y = ny / length, dot = x * -after.y + y * after.x;
        // Bounded miter: sharp turns cannot grow long spikes.
        const full = half / Math.max(dot, 1e-6);
        bevel = full > localWidth;
        const distance = Math.min(full, localWidth);
        offset = { x: x * distance, y: y * distance };
      }
    }
    const left = { x: point.x + offset.x, y: point.y + offset.y }, right = { x: point.x - offset.x, y: point.y - offset.y };
    let beforeLeft = left, afterLeft = left, beforeRight = right, afterRight = right;
    if (bevel) {
      if (before.x * after.y - before.y * after.x > 0) {
        beforeRight = { x: point.x + before.y * half, y: point.y - before.x * half };
        afterRight = { x: point.x + after.y * half, y: point.y - after.x * half };
      } else {
        beforeLeft = { x: point.x - before.y * half, y: point.y + before.x * half };
        afterLeft = { x: point.x - after.y * half, y: point.y + after.x * half };
      }
    }
    return { startLeft: afterLeft, startRight: afterRight,
      end: beforeLeft !== afterLeft ? [beforeLeft, afterLeft, beforeRight] : beforeRight !== afterRight ? [beforeLeft, afterRight, beforeRight] : [beforeLeft, beforeRight] };
  });
  return tangents.map((t, i) => ({ a: points[i], b: points[(i + 1) % points.length], length: t.length,
    startWidth: points[i].width ?? width, endWidth: points[(i + 1) % points.length].width ?? width,
    angle: Math.atan2(t.y, t.x), polygon: [joins[i].startLeft, ...joins[(i + 1) % points.length].end, joins[i].startRight] }));
}

export function wallHit(points: readonly (Vec2 & { width?: number })[], width: number, closed: boolean, point: Vec2, slack: number) {
  return wallSegments(points, width, closed).some(segment => {
    const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
    const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / segment.length ** 2));
    const localWidth = segment.startWidth + (segment.endWidth - segment.startWidth) * t;
    return Math.hypot(point.x - segment.a.x - t * dx, point.y - segment.a.y - t * dy) <= localWidth / 2 + slack;
  });
}
