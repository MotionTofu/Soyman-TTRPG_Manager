// Pure geometry helpers: сдвиг фигур (Фаза 2E).
// Только translateShape — никакого общего geometry framework сверх задачи.

import type { ShapeGeometry, Vec2 } from "../types";

/** Сдвиг фигуры на delta (rect/polygon/ellipse). Вход не мутируется. */
export function translateShape(shape: ShapeGeometry, delta: Vec2): ShapeGeometry {
  if (shape.type === "rect") {
    return { type: "rect", x: shape.x + delta.x, y: shape.y + delta.y, w: shape.w, h: shape.h };
  }
  if (shape.type === "polygon") {
    return {
      type: "polygon",
      points: shape.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
    };
  }
  return {
    type: "ellipse",
    center: { x: shape.center.x + delta.x, y: shape.center.y + delta.y },
    rx: shape.rx,
    ry: shape.ry,
  };
}
