export type NewLayerKind = "terrain" | "mask" | "path" | "scatter" | "gameplay" | "label" | "object";

// Old documents carry English default names; show them in Russian until renamed.
const DEFAULT_NAMES: Record<string, string> = { Terrain: "Поверхности", Rivers: "Реки", Roads: "Дороги", Gameplay: "Комнаты и двери",
  Labels: "Подписи", Objects: "Объекты", "Map Objects": "Объекты", Scatter: "Россыпи" };
export const layerName = (layer: { name: string }) => DEFAULT_NAMES[layer.name] ?? layer.name;
export const NEW_LAYERS: Record<NewLayerKind, string> = { mask: "Поверхность", terrain: "Клетки пола", path: "Реки и дороги",
  scatter: "Россыпь", gameplay: "Комнаты и токены", label: "Подписи", object: "Объекты" };
