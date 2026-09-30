import { rasterAsset } from "../../rasterAssets";

export const CARTOGRAPHY_PACK = { id: "soyman-cartography", version: "1" } as const;
export const CARTOGRAPHY_OBJECTS = [
  { key: "stone-wall", name: "Каменная кладка", group: "dungeon", size: 4 },
  { key: "wood-door", name: "Деревянная дверь · декор", group: "dungeon", size: 1.5 },
  { key: "sarcophagus", name: "Саркофаг", group: "dungeon", size: 2.5 },
  { key: "altar", name: "Алтарь", group: "dungeon", size: 2.5 },
  { key: "storage-cluster", name: "Бочки и ящики", group: "dungeon", size: 2 },
  { key: "bone-pile", name: "Кости", group: "dungeon", size: 1.5 },
  { key: "rock-cluster", name: "Валуны", group: "dungeon", size: 2 },
  { key: "stone-pillar", name: "Колонна", group: "dungeon", size: 1.2 },
  { key: "torch", name: "Факел", group: "dungeon", size: 1.2 },
  { key: "pine", name: "Сосна", group: "region", size: 2.5 },
  { key: "mountain-ridge", name: "Горный хребет", group: "region", size: 3 },
  { key: "ruins", name: "Руины", group: "region", size: 2.5 },
  { key: "outpost", name: "Застава", group: "region", size: 2.5 },
] as const;
export const CARTOGRAPHY_SURFACES = [
  { code: "stone", name: "Камень", key: "stone-floor" },
  { code: "earth", name: "Земля", key: "earth" },
  { code: "shallow_water", name: "Вода", key: "water" },
  { code: "wood", name: "Дерево", key: null },
  { code: "plain", name: "Равнина", key: null },
  { code: "forest", name: "Лесная почва", key: "earth" },
  { code: "hills", name: "Холмы", key: "earth" },
  { code: "mountains", name: "Горы", key: null },
  { code: "desert", name: "Песок", key: "earth" },
  { code: "swamp", name: "Болото", key: null },
] as const;
export const cartographyId = (key: string) => `${CARTOGRAPHY_PACK.id}:${key}`;
export const cartographyUrl = (key: string) => rasterAsset("cartography", key)!;
export function cartographySize(id: string): number {
  return CARTOGRAPHY_OBJECTS.find(item => cartographyId(item.key) === id)?.size ?? 1;
}

export const CARTOGRAPHY_SCATTER = [
  { key: "scatter/cartography-forest-v1", name: "Рисованный лес", assetId: cartographyId("pine") },
  { key: "scatter/cartography-mountains-v1", name: "Рисованные горы", assetId: cartographyId("mountain-ridge") },
] as const;
