import type { ScatterArea, ShapeGeometry, Vec2, MapObject } from "./core/types";
import { ARTWORK_SCATTER, loadMapImageAsset, resolveMapSymbol, type MapVisualAsset } from "./assets/registry";
import { ownScatter } from "./assets/ownPacks";

export const SCATTER_LIMIT = 5000;
export const SCATTER_PROFILES: readonly { key: string; name: string; assetId: string; assetIds: readonly string[]; size: number }[] = [
  { key: "scatter/forest", name: "Лес", assetId: "soyman-symbols:tree", assetIds: ["soyman-symbols:tree"], size: 1 },
  { key: "scatter/mountains", name: "Горы", assetId: "soyman-symbols:mountain", assetIds: ["soyman-symbols:mountain"], size: 1 },
  ...ARTWORK_SCATTER,
];
/** Россыпь и вода: сухопутная на воду не ложится, прибрежная растёт и на мелководье, плавучая лежит где угодно.
 * Число — до какой воды пускают: 0 — только суша, 1 — мелко, 2 — и глубоко (как у `waterDepth`). Свои наборы — сухопутные. */
const SHORE = new Set(["scatter/village-reeds-v1", "scatter/village-cattails-v1", "scatter/world-reeds-v1"]);
const AFLOAT = new Set(["scatter/village-lilies-v1", "scatter/village-leaves-v1"]);
export const scatterWaterReach = (key: string | null) => key && AFLOAT.has(key) ? 2 : key && SHORE.has(key) ? 1 : 0;
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
  // Россыпь своего набора: её картинки грузятся по первому обращению.
  const profile = SCATTER_PROFILES.find(p => p.key === key) ?? ownScatter(key ?? "");
  const size = area.overrides?.size ?? 1;
  if (!profile || typeof size !== "number" || !Number.isFinite(size) || size < 0.25 || size > 8 ||
      Object.keys(area.overrides ?? {}).some(key => key !== "size")) return { items: [], error: "Неизвестная россыпь или её параметры" };
  const bounds = shapeBounds(area.shape), candidates = Math.ceil(bounds.w * bounds.h * area.density);
  if (!Number.isSafeInteger(candidates) || candidates > SCATTER_LIMIT) return { items: [], error: "Россыпь слишком велика: уменьшите плотность или область" };
  let state = area.seed >>> 0;
  const random = () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const assets = profile.assetIds.flatMap(assetId => resolveMapSymbol({ type: "asset", assetId }) ?? []);
  if (!assets.length) return { items: [], error: "У россыпи нет картинок" };
  for (const asset of assets) if ("image" in asset && !asset.image && !asset.failed && asset.id.startsWith("soyman-resource-images:")) void loadMapImageAsset(asset.id).catch(() => undefined);
  const items: ScatterInstances["items"][number][] = [];
  for (let i = 0; i < candidates; i++) {
    const position = { x: bounds.x + random() * bounds.w, y: bounds.y + random() * bounds.h };
    const jitter = random(), scale = size * profile.size * (0.75 + jitter * 0.5), rotation = (random() - 0.5) * 16;
    // Вариант — из уже вытянутого числа, без лишнего шага генератора: старые россыпи не меняются.
    const asset = assets[Math.floor(jitter * 7919) % assets.length];
    if (!shapeContains(area.shape, position)) continue;
    items.push({ asset, object: { id: `${area.id}:instance:${i}`, visual: { type: "asset", assetId: asset.id },
      transform: { position, rotation, scale: { x: scale, y: scale } } } });
  }
  // Northern symbols behind southern ones, without affecting layer order.
  items.sort((a, b) => a.object.transform.position.y - b.object.transform.position.y);
  const result = { items }; cache.set(area, result); return result;
}
