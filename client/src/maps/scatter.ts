import { CARTOGRAPHY_SCATTER } from "./assets/cartography";
import type { ScatterArea, ShapeGeometry, Vec2, MapObject } from "./core/types";
import { resolveMapSymbol, type MapVisualAsset } from "./assets/registry";

export const SCATTER_LIMIT = 5000;
export const SCATTER_PROFILES = [
  { key: "scatter/forest", name: "Лес", assetId: "soyman-symbols:tree" },
  { key: "scatter/mountains", name: "Горы", assetId: "soyman-symbols:mountain" },
  ...CARTOGRAPHY_SCATTER,
] as const;
export function shapeBounds(shape: ShapeGeometry) {
  if (shape.type === "rect") return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  if (shape.type === "ellipse") return { x: shape.center.x - shape.rx, y: shape.center.y - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
  const xs = shape.points.map(p => p.x), ys = shape.points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function shapeContains(shape: ShapeGeometry, point: Vec2): boolean {
  if (shape.type === "rect") return point.x >= shape.x && point.x <= shape.x + shape.w && point.y >= shape.y && point.y <= shape.y + shape.h;
  if (shape.type === "ellipse") return ((point.x - shape.center.x) / shape.rx) ** 2 + ((point.y - shape.center.y) / shape.ry) ** 2 <= 1;
  let inside = false;
  for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
    const a = shape.points[i], b = shape.points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function translateShape(shape: ShapeGeometry, delta: Vec2): ShapeGeometry {
  if (shape.type === "rect") return { ...shape, x: shape.x + delta.x, y: shape.y + delta.y };
  if (shape.type === "ellipse") return { ...shape, center: { x: shape.center.x + delta.x, y: shape.center.y + delta.y } };
  return { ...shape, points: shape.points.map(p => ({ x: p.x + delta.x, y: p.y + delta.y })) };
}
export interface ScatterInstances { items: readonly { object: MapObject; asset: MapVisualAsset }[]; error?: string }
const cache = new WeakMap<ScatterArea, ScatterInstances>();
/** Derived, deterministic artwork. Only the area, seed and settings are saved. */
export function scatterInstances(area: ScatterArea): ScatterInstances {
  const cached = cache.get(area); if (cached) return cached;
  const key = area.profileRef.type === "builtin" ? area.profileRef.key : null;
  const profile = SCATTER_PROFILES.find(p => p.key === key);
  const size = area.overrides?.size ?? 1;
  if (!profile || typeof size !== "number" || !Number.isFinite(size) || size < 0.25 || size > 8 ||
      Object.keys(area.overrides ?? {}).some(key => key !== "size")) return { items: [], error: "Неизвестная россыпь или её параметры" };
  const bounds = shapeBounds(area.shape), candidates = Math.ceil(bounds.w * bounds.h * area.density);
  if (!Number.isSafeInteger(candidates) || candidates > SCATTER_LIMIT) return { items: [], error: "Россыпь слишком велика: уменьшите плотность или область" };
  let state = area.seed >>> 0;
  const random = () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const asset = resolveMapSymbol({ type: "asset", assetId: profile.assetId })!;
  const items: ScatterInstances["items"][number][] = [];
  for (let i = 0; i < candidates; i++) {
    const position = { x: bounds.x + random() * bounds.w, y: bounds.y + random() * bounds.h };
    const scale = size * (0.75 + random() * 0.5), rotation = (random() - 0.5) * 16;
    if (!shapeContains(area.shape, position)) continue;
    items.push({ asset, object: { id: `${area.id}:instance:${i}`, visual: { type: "asset", assetId: asset.id },
      transform: { position, rotation, scale: { x: scale, y: scale } } } });
  }
  // Northern symbols behind southern ones, without affecting layer order.
  items.sort((a, b) => a.object.transform.position.y - b.object.transform.position.y);
  const result = { items }; cache.set(area, result); return result;
}
