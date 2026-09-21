// V5 gameplay hit-test: world point → stable EntityId (Фаза 2E).
// Приоритет как у legacy (door → trap → marker → start → finish → room;
// комнаты — reverse, верхняя побеждает). Геометрия — напрямую из V5
// (position/orientation/ShapeGeometry), без реконструкции x/y/edge.
// Боксы соответствуют renderer-плашкам (дверь 0.72×0.34, trap/marker 0.6,
// start r=0.38, finish 1.0) + опциональный tolerance.

import type { MapDocumentV5, ShapeGeometry, Vec2 } from "../types";
import type { V5SelectableKind, V5Selection } from "./types";

const DOOR_HALF_U = 0.36;
const DOOR_HALF_V = 0.17;
const POINT_HALF = 0.3;
const START_RADIUS = 0.38;
const FINISH_HALF = 0.5;

function pointInShape(shape: ShapeGeometry, p: Vec2): boolean {
  if (shape.type === "rect") {
    return p.x >= shape.x && p.x <= shape.x + shape.w && p.y >= shape.y && p.y <= shape.y + shape.h;
  }
  if (shape.type === "ellipse") {
    if (shape.rx <= 0 || shape.ry <= 0) return false;
    const dx = (p.x - shape.center.x) / shape.rx;
    const dy = (p.y - shape.center.y) / shape.ry;
    return dx * dx + dy * dy <= 1;
  }
  // polygon: even-odd ray cast; <3 точек — не область.
  const pts = shape.points;
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Плашка двери в её локальных осях (u — вдоль ребра, v — поперёк). */
function doorHit(orientation: number, pos: Vec2, p: Vec2, tolerance: number): boolean {
  // Локальные оси из orientation (clockwise от севера, ось Y вниз):
  // u — вдоль ребра, v — поперёк. Проверка — проекции на обе оси.
  const rad = ((orientation + 90) * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = -Math.cos(rad);
  const vrad = (orientation * Math.PI) / 180;
  const vx = Math.sin(vrad);
  const vy = -Math.cos(vrad);
  const dx = p.x - pos.x;
  const dy = p.y - pos.y;
  const a = dx * ux + dy * uy;
  const b = dx * vx + dy * vy;
  return Math.abs(a) <= DOOR_HALF_U + tolerance && Math.abs(b) <= DOOR_HALF_V + tolerance;
}

/**
 * Hit-test gameplay-сущностей по мировой точке.
 * Возвращает selection с EntityId или null. Не мутирует документ.
 */
export function hitTestGameplay(
  doc: MapDocumentV5,
  point: Vec2,
  tolerance = 0,
): V5Selection | null {
  if (
    typeof point !== "object" ||
    point === null ||
    typeof point.x !== "number" ||
    typeof point.y !== "number" ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    typeof tolerance !== "number" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    return null;
  }
  const items: Array<{ entityId: string; kind: V5SelectableKind; rank: number }> = [];
  const rooms: Array<{ entityId: string; shape: ShapeGeometry }> = [];

  for (const layer of doc.layers) {
    if (layer.kind !== "gameplay") continue;
    for (const e of layer.items) {
      if (e.kind === "door") {
        if (doorHit(e.orientation, e.position, point, tolerance)) {
          return { entityId: e.id, kind: "door" };
        }
      } else if (e.kind === "trap") {
        if (
          Math.abs(point.x - e.position.x) <= POINT_HALF + tolerance &&
          Math.abs(point.y - e.position.y) <= POINT_HALF + tolerance
        ) {
          items.push({ entityId: e.id, kind: "trap", rank: 1 });
        }
      } else if (e.kind === "marker") {
        if (
          Math.abs(point.x - e.position.x) <= POINT_HALF + tolerance &&
          Math.abs(point.y - e.position.y) <= POINT_HALF + tolerance
        ) {
          items.push({ entityId: e.id, kind: "marker", rank: 2 });
        }
      } else if (e.kind === "start") {
        const dx = point.x - e.position.x;
        const dy = point.y - e.position.y;
        const r = START_RADIUS + tolerance;
        if (dx * dx + dy * dy <= r * r) items.push({ entityId: e.id, kind: "start", rank: 3 });
      } else if (e.kind === "finish") {
        if (
          Math.abs(point.x - e.position.x) <= FINISH_HALF + tolerance &&
          Math.abs(point.y - e.position.y) <= FINISH_HALF + tolerance
        ) {
          items.push({ entityId: e.id, kind: "finish", rank: 4 });
        }
      } else if (e.kind === "room") {
        rooms.push({ entityId: e.id, shape: e.geometry });
      }
    }
  }

  // Приоритет legacy: door (уже возвращена выше) → trap → marker → start → finish.
  // Внутри одного вида — первая в порядке items.
  let best: { entityId: string; kind: V5SelectableKind; rank: number } | null = null;
  for (const it of items) {
    if (best === null || it.rank < best.rank) best = it;
  }
  if (best !== null) return { entityId: best.entityId, kind: best.kind };

  // Комнаты — reverse (верхняя побеждает, как legacy).
  for (let i = rooms.length - 1; i >= 0; i--) {
    if (pointInShape(rooms[i].shape, point)) {
      return { entityId: rooms[i].entityId, kind: "room" };
    }
  }
  return null;
}

export type { V5SelectableKind, V5Selection };
