import type { SplineNode, Vec2 } from "./types";

/** Bézier control points are absolute world positions, like node.position. */
export function splineFromAnchors(anchors: readonly Vec2[]): SplineNode[] {
  return anchors.map((position, index) => {
    const previous = anchors[Math.max(0, index - 1)];
    const next = anchors[Math.min(anchors.length - 1, index + 1)];
    const tangent = { x: (next.x - previous.x) / 6, y: (next.y - previous.y) / 6 };
    return {
      position: { ...position },
      ...(index > 0 ? { in: { x: position.x - tangent.x, y: position.y - tangent.y } } : {}),
      ...(index < anchors.length - 1
        ? { out: { x: position.x + tangent.x, y: position.y + tangent.y } } : {}),
    };
  });
}

export function flattenSplineNodes(nodes: readonly SplineNode[], maxStep: number): Vec2[] {
  if (!nodes.length) return [];
  const points: Vec2[] = [{ ...nodes[0].position }];
  const step = Number.isFinite(maxStep) && maxStep > 0 ? maxStep : 0.1;
  for (let index = 1; index < nodes.length; index++) {
    const from = nodes[index - 1];
    const to = nodes[index];
    if (!from.out || !to.in) {
      points.push({ ...to.position });
      continue;
    }
    const p0 = from.position, p1 = from.out, p2 = to.in, p3 = to.position;
    const controlLength = Math.hypot(p1.x - p0.x, p1.y - p0.y) +
      Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
    const count = Math.max(4, Math.min(1024, Math.ceil(controlLength / step)));
    for (let sample = 1; sample <= count; sample++) {
      const t = sample / count, inverse = 1 - t;
      points.push({
        x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x +
          3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
        y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y +
          3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y,
      });
    }
  }
  return points;
}

export interface SplineWidthSample extends Vec2 { width: number }

/** Samples the curve and linearly blends the width of neighboring anchors. */
export function flattenSplineWithWidths(nodes: readonly SplineNode[], baseWidth: number,
  maxStep: number): SplineWidthSample[] {
  if (!nodes.length) return [];
  const points: SplineWidthSample[] = [{ ...nodes[0].position, width: nodes[0].width ?? baseWidth }];
  const step = Number.isFinite(maxStep) && maxStep > 0 ? maxStep : 0.1;
  for (let index = 1; index < nodes.length; index++) {
    const from = nodes[index - 1], to = nodes[index];
    const curved = !!from.out && !!to.in;
    const p0 = from.position, p1 = from.out ?? p0, p2 = to.in ?? to.position, p3 = to.position;
    const controlLength = curved
      ? Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) +
        Math.hypot(p3.x - p2.x, p3.y - p2.y)
      : Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const fromWidth = from.width ?? baseWidth, toWidth = to.width ?? baseWidth;
    const count = Math.min(1024, Math.max(curved ? 4 : 1, fromWidth !== toWidth ? 8 : 1,
      Math.ceil(controlLength / step)));
    for (let sample = 1; sample <= count; sample++) {
      const t = sample / count;
      const point = curved ? {
        x: (1 - t) ** 3 * p0.x + 3 * (1 - t) ** 2 * t * p1.x +
          3 * (1 - t) * t ** 2 * p2.x + t ** 3 * p3.x,
        y: (1 - t) ** 3 * p0.y + 3 * (1 - t) ** 2 * t * p1.y +
          3 * (1 - t) * t ** 2 * p2.y + t ** 3 * p3.y,
      } : { x: p0.x + (p3.x - p0.x) * t, y: p0.y + (p3.y - p0.y) * t };
      points.push({ ...point, width: fromWidth + (toWidth - fromWidth) * t });
    }
  }
  return points;
}
