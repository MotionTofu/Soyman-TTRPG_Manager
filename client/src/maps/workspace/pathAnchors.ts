import type { SplineNode, Vec2 } from "@shared/maps/core";

export function pathNodesFromAnchors(points: readonly Vec2[], closed = false): SplineNode[] {
  return points.map((position, i) => {
    const previous = points[closed ? (i + points.length - 1) % points.length : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % points.length : Math.min(points.length - 1, i + 1)];
    const tangent = { x: (next.x - previous.x) / 6, y: (next.y - previous.y) / 6 };
    return { position: { ...position }, ...(closed || i > 0 ? { in: { x: position.x - tangent.x, y: position.y - tangent.y } } : {}),
      ...(closed || i < points.length - 1 ? { out: { x: position.x + tangent.x, y: position.y + tangent.y } } : {}) };
  });
}
