/**
 * Нейтральные literal-контракты Map Core V5 (single source of truth).
 * Значения побайтово совпадают с legacy client (maps/render.ts) и server
 * (routes/mapsValidation.ts): snake_case кодов, порядки, наборы.
 * Renderer и server-валидация импортируют отсюда, а не дублируют.
 * Node-safe: только константы, без DOM/React/import.meta.
 */

export type MapGridType = "square" | "hex";
export const MAP_GRID_TYPES: readonly MapGridType[] = ["square", "hex"];

export type MapScaleName =
  | "planet"
  | "continent"
  | "country"
  | "region"
  | "settlement"
  | "locality";
export const MAP_SCALE_NAMES: readonly MapScaleName[] = [
  "planet",
  "continent",
  "country",
  "region",
  "settlement",
  "locality",
];

/** 18 terrain codes, snake_case (порядок — канонический, как в legacy). */
export const MAP_TERRAIN_CODES = [
  "deep_water",
  "shallow_water",
  "plain",
  "forest",
  "hills",
  "mountains",
  "desert",
  "ice",
  "swamp",
  "lava",
  "acid",
  "poison",
  "wall",
  "stone",
  "wood",
  "earth",
  "darkness",
  "necro",
] as const;
export type MapTerrainCode = (typeof MAP_TERRAIN_CODES)[number];

export const MAP_ROOM_TYPES = ["empty", "barracks", "temple", "treasury", "prison", "lab"] as const;
export type MapRoomType = (typeof MAP_ROOM_TYPES)[number];

export const MAP_DOOR_KINDS = ["arch", "door", "locked", "trapped", "secret", "portc"] as const;
export type MapDoorKind = (typeof MAP_DOOR_KINDS)[number];

export const MAP_TRAP_KINDS = ["pit", "arrow", "gas", "glyph"] as const;
export type MapTrapKind = (typeof MAP_TRAP_KINDS)[number];

export const MAP_MARKER_KINDS = [
  "chest",
  "altar",
  "city",
  "village",
  "camp",
  "metro",
  "battle",
  "obelisk",
] as const;
export type MapMarkerKind = (typeof MAP_MARKER_KINDS)[number];
