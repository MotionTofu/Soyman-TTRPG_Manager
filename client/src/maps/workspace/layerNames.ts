import type { MapKind } from "../mapTypes";

export type NewLayerKind = "terrain" | "mask" | "path" | "scatter" | "gameplay" | "label" | "object" | "reference";

// Old documents carry English default names; show them in Russian until renamed.
const DEFAULT_NAMES: Record<string, string> = { Terrain: "Поверхности", Rivers: "Реки", Roads: "Дороги", Gameplay: "Комнаты и двери",
  Labels: "Подписи", Objects: "Объекты", "Map Objects": "Объекты", Scatter: "Россыпи" };
/** На карте «Город» в слое комнат лежат кварталы (решение владельца 2026-10-21): заводское имя показывается так. */
const CITY_ROOMS = new Set(["Gameplay", "Комнаты и двери", "Комнаты и токены"]);
export const CITY_ROOMS_NAME = "Кварталы";
export const layerName = (layer: { kind?: string; name: string }, map?: MapKind) =>
  map === "city" && layer.kind === "gameplay" && CITY_ROOMS.has(layer.name) ? CITY_ROOMS_NAME : DEFAULT_NAMES[layer.name] ?? layer.name;
export const newLayerName = (kind: NewLayerKind, map: MapKind) => map === "city" && kind === "gameplay" ? CITY_ROOMS_NAME : NEW_LAYERS[kind];
export const NEW_LAYERS: Record<NewLayerKind, string> = { mask: "Поверхность", terrain: "Клетки пола", path: "Реки и дороги",
  scatter: "Россыпь", gameplay: "Комнаты и токены", label: "Подписи", object: "Объекты", reference: "Подложка" };
