import { rasterAsset } from "../../rasterAssets";
import { pickVariant as pickVillageVariant, variantKeys } from "./village";
import type { SurfaceEdge } from "./surfaceEdge";

/** «Мир» — набор обзорной карты (гриллинг М1–М17, 2026-10-15). Листы Codex в стиле концепта «а» — `.scratch/map-world/`,
 * provenance — world-pack.json. Семейства с вариантами устроены как в «Деревне»: `key`, `key-2`, `key-3`. */
export const WORLD_PACK = { id: "soyman-world", version: "1" } as const;
export type WorldCategory = "settlements" | "places" | "relief";
export const WORLD_CATEGORIES: Record<WorldCategory, string> = { settlements: "Поселения", places: "Места", relief: "Рельеф и лес" };
/** Знак лежит на карте размером в клетках (М2): по умолчанию по рангу (М12), рельеф — по клетке. */
export const WORLD_OBJECTS: readonly { key: string; name: string; category: WorldCategory; cells: readonly [number, number]; variants: number }[] = [
  { key: "capital", name: "Столица", category: "settlements", cells: [2, 2], variants: 1 },
  { key: "town", name: "Город", category: "settlements", cells: [1.5, 1.5], variants: 1 },
  { key: "village", name: "Деревня", category: "settlements", cells: [1, 1], variants: 1 },
  { key: "hamlet", name: "Хутор", category: "settlements", cells: [0.7, 0.7], variants: 1 },
  { key: "castle", name: "Замок", category: "places", cells: [1, 1], variants: 1 },
  { key: "fortress", name: "Крепость, застава", category: "places", cells: [1, 1], variants: 1 },
  { key: "tower", name: "Башня", category: "places", cells: [1, 1], variants: 1 },
  { key: "temple", name: "Храм", category: "places", cells: [1, 1], variants: 1 },
  { key: "ruins", name: "Руины", category: "places", cells: [1, 1], variants: 1 },
  { key: "cave", name: "Пещера, вход в подземелье", category: "places", cells: [1, 1], variants: 1 },
  { key: "mine", name: "Шахта", category: "places", cells: [1, 1], variants: 1 },
  { key: "port", name: "Порт", category: "places", cells: [1, 1], variants: 1 },
  { key: "lighthouse", name: "Маяк", category: "places", cells: [1, 1], variants: 1 },
  { key: "pass", name: "Перевал", category: "places", cells: [1, 1], variants: 1 },
  { key: "camp", name: "Лагерь", category: "places", cells: [1, 1], variants: 1 },
  { key: "landmark", name: "Место интереса", category: "places", cells: [1, 1], variants: 1 },
  // Штампы россыпи (М10) — их же можно поставить поштучно.
  { key: "mountains", name: "Горы", category: "relief", cells: [1.2, 1.2], variants: 3 },
  { key: "snowy", name: "Горы со снегом", category: "relief", cells: [1.2, 1.2], variants: 2 },
  { key: "hills", name: "Холмы", category: "relief", cells: [1, 1], variants: 3 },
  { key: "woods", name: "Лиственный лес", category: "relief", cells: [0.9, 0.9], variants: 3 },
  { key: "pines", name: "Хвойный лес", category: "relief", cells: [0.9, 0.9], variants: 3 },
  { key: "scrub", name: "Кустарник, пустошь", category: "relief", cells: [0.8, 0.8], variants: 2 },
  { key: "reeds", name: "Кочки и тростник", category: "relief", cells: [0.7, 0.7], variants: 2 },
  { key: "dunes", name: "Дюны", category: "relief", cells: [1, 1], variants: 2 },
];
/** Поверхности (М11): код материала на карте — `world-<ключ>`. Один повтор картинки — 4 клетки. */
export const WORLD_SURFACES: readonly { key: string; name: string; fill: string; edge: SurfaceEdge }[] = [
  { key: "meadow", name: "Луг", fill: "#7d8a52", edge: { width: 0.6, rough: 0.7, tier: 1 } },
  { key: "steppe", name: "Степь", fill: "#a8914f", edge: { width: 0.6, rough: 0.6, tier: 1 } },
  { key: "forest-floor", name: "Лесная подложка", fill: "#5a6146", edge: { width: 0.6, rough: 0.7, tier: 1 } },
  { key: "desert", name: "Пустыня", fill: "#e6cf98", edge: { width: 0.6, rough: 0.4, tier: 0 } },
  { key: "snow", name: "Снег, тундра", fill: "#e3e6e6", edge: { width: 0.6, rough: 0.6, tier: 2 } },
  { key: "rock", name: "Скальная земля", fill: "#9a8f80", edge: { width: 0.5, rough: 0.6, tier: 2 } },
  { key: "swamp", name: "Болото", fill: "#4c4f36", edge: { width: 0.6, rough: 0.6, tier: 0 } },
  { key: "heath", name: "Вересковая пустошь", fill: "#5f4a45", edge: { width: 0.6, rough: 0.7, tier: 1 } },
];
const SURFACE_PREFIX = "world-";
export const worldSurfaceCode = (key: string) => `${SURFACE_PREFIX}${key}`;
const surfaceByKey = new Map(WORLD_SURFACES.map(item => [item.key, item]));
/** Ключ картинки по коду материала; `null` — код не из «Мира». */
export const worldSurfaceKey = (code: string) => code.startsWith(SURFACE_PREFIX) && surfaceByKey.has(code.slice(SURFACE_PREFIX.length)) ? code.slice(SURFACE_PREFIX.length) : null;
export const worldSurfaceEdge = (key: string) => surfaceByKey.get(key)?.edge ?? null;
export const WORLD_FILL: Readonly<Record<string, string>> = Object.fromEntries(WORLD_SURFACES.map(item => [worldSurfaceCode(item.key), item.fill]));

export const worldId = (key: string) => `${WORLD_PACK.id}:${key}`;
export const worldUrl = (key: string) => rasterAsset("world", key)!;
const objectByKey = new Map(WORLD_OBJECTS.flatMap(item => variantKeys(item.key, item.variants).map(key => [key, item] as const)));
export const worldObject = (id: string) => id.startsWith(`${WORLD_PACK.id}:`) ? objectByKey.get(id.slice(WORLD_PACK.id.length + 1)) ?? null : null;
export const WORLD_OBJECT_KEYS = WORLD_OBJECTS.flatMap(item => variantKeys(item.key, item.variants));

/** Россыпи рельефа: экземпляры — из вариантов семейства вразнобой; `size` — клеток на экземпляр при размере 1. */
const scatter = (key: string, name: string, size: number, variants: number) =>
  ({ key: `scatter/world-${key}-v1`, name, assetId: worldId(key), assetIds: variantKeys(key, variants).map(worldId), size });
export const WORLD_SCATTER = WORLD_OBJECTS.filter(item => item.category === "relief").map(item => scatter(item.key, item.name, item.cells[0], item.variants));
/** «Случайный вариант» семейства «Мира» или «Деревни» — на карту попадает конкретный вариант. */
export function pickVariant(assetId: string, random: () => number = Math.random): string {
  const item = assetId.endsWith("*") ? worldObject(assetId.slice(0, -1)) : null;
  return item ? worldId(variantKeys(item.key, item.variants)[Math.floor(random() * item.variants)]) : pickVillageVariant(assetId, random);
}
