// Чистая валидация карт: без импорта db (у него побочный эффект — открытие
// базы), поэтому живёт отдельно от routes/maps.ts и тестируется напрямую
// (см. maps.test.ts — тот же приём, что storages.test.ts).

export const MAP_GRIDS = ["square", "hex"] as const;
export type MapGrid = (typeof MAP_GRIDS)[number];

export const MAP_SCALES = [
  "planet",
  "continent",
  "country",
  "region",
  "settlement",
  "locality",
] as const;
export type MapScale = (typeof MAP_SCALES)[number];

export const MAP_TERRAINS = [
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
export type MapTerrain = (typeof MAP_TERRAINS)[number];

// Дефолты пресетов масштаба: размер поля + подпись «1 клетка =».
export const MAP_SCALE_PRESETS: Record<MapScale, { width: number; height: number; cellLore: string }> = {
  planet: { width: 24, height: 18, cellLore: "500 км" },
  continent: { width: 40, height: 30, cellLore: "100 км" },
  country: { width: 50, height: 36, cellLore: "20 км" },
  region: { width: 60, height: 44, cellLore: "2 км" },
  settlement: { width: 40, height: 30, cellLore: "20 м" },
  locality: { width: 50, height: 36, cellLore: "5 м" },
};

export const MAP_MIN_SIDE = 8;
export const MAP_MAX_SIDE = 100;
export const MAP_MAX_THUMBNAIL_CHARS = 300_000;
export const MAP_MAX_LABELS = 200;
export const MAP_MAX_LABEL_TEXT = 64;
// Слой объектов, пакет A: капы держат размер автосейва (шлётся весь blob).
export const MAP_MAX_ROOMS = 100;
export const MAP_MAX_DOORS = 400;
export const MAP_MAX_TRAPS = 300;
export const MAP_MAX_MARKERS = 300;
export const MAP_MAX_ROOM_NAME = 64;

export const MAP_ROOM_TYPES = ["empty", "barracks", "temple", "treasury", "prison", "lab"] as const;
export const MAP_DOOR_KINDS = ["arch", "door", "locked", "trapped", "secret", "portc"] as const;
export const MAP_DOOR_EDGES = ["n", "s", "e", "w"] as const;
export const MAP_TRAP_KINDS = ["pit", "arrow", "gas", "glyph"] as const;
export const MAP_MARKER_KINDS = ["chest", "altar", "city", "village", "camp", "metro", "battle", "obelisk"] as const;

// Миниатюры пишет только наш рендер (canvas.toDataURL("image/png")).
// Произвольные строки запрещены (P0-6): клиент вставляет thumbnail в
// style backgroundImage, и закрывающая кавычка чужой строки вырывалась бы
// из url() в соседние CSS-свойства.
export const MAP_THUMBNAIL_PREFIX = "data:image/png;base64,";

export function isThumbnail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > MAP_MAX_THUMBNAIL_CHARS) return false;
  if (!value.startsWith(MAP_THUMBNAIL_PREFIX)) return false;
  const body = value.slice(MAP_THUMBNAIL_PREFIX.length);
  if (body.length === 0 || body.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]*={0,2}$/.test(body);
}

export interface MapCellsBlob {
  v: 1 | 2 | 3 | 4;
  cells: Record<string, string>;
  roads: string[];
  rivers?: string[];
  labels?: { x: number; y: number; text: string }[];
  rooms?: { x: number; y: number; w: number; h: number; type: string; name: string }[];
  doors?: { x: number; y: number; edge: string; kind: string; secret: boolean; pair: string | null }[];
  traps?: { x: number; y: number; kind: string }[];
  markers?: { x: number; y: number; kind: string }[];
  start?: { x: number; y: number } | null;
  finish?: { x: number; y: number } | null;
}

export function emptyCellsBlob(): MapCellsBlob {
  return { v: 1, cells: {}, roads: [] };
}

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function keyInBounds(key: string, width: number, height: number): boolean {
  const m = /^(\d+),(\d+)$/.exec(key);
  if (!m) return false;
  const x = Number(m[1]);
  const y = Number(m[2]);
  return x >= 0 && y >= 0 && x < width && y < height;
}

// Проверяет blob клеток как строку (то, что лежит в колонке `cells`).
// Возвращает ошибку текстом или null, если всё хорошо.
export function validateCellsBlob(raw: unknown, width: number, height: number): string | null {
  if (typeof raw !== "string") return "cells must be a string";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "cells must be valid JSON";
  }
  if (typeof parsed !== "object" || parsed === null) return "cells must be an object";
  const blob = parsed as Record<string, unknown>;
  // v1 — только краска, v2 — плюс подписи, v3 — плюс слой объектов (пакет A),
  // v4 — плюс реки и маркеры (стены/объекты). Старые карты читаются как были.
  if (blob.v !== 1 && blob.v !== 2 && blob.v !== 3 && blob.v !== 4) return "cells.v must be 1, 2, 3 or 4";
  if (typeof blob.cells !== "object" || blob.cells === null || Array.isArray(blob.cells))
    return "cells.cells must be an object";
  if (!Array.isArray(blob.roads)) return "cells.roads must be an array";
  // Реки/маркеры младше v4 не знают: непустые в старом конверте — ошибка, а не молчаливый дроп.
  if (blob.v !== 4) {
    if (Array.isArray(blob.rivers) && blob.rivers.length > 0) return "cells.rivers needs v4";
    if (Array.isArray(blob.markers) && (blob.markers as unknown[]).length > 0) return "cells.markers needs v4";
  }
  if (blob.v === 4 && blob.rivers !== undefined) {
    if (!Array.isArray(blob.rivers)) return "cells.rivers must be an array";
    for (const key of blob.rivers as unknown[]) {
      if (typeof key !== "string" || !keyInBounds(key, width, height)) return `river ${String(key)} out of bounds`;
    }
  }
  for (const [key, terrain] of Object.entries(blob.cells as Record<string, unknown>)) {
    if (!keyInBounds(key, width, height)) return `cell ${key} out of bounds`;
    if (typeof terrain !== "string" || !(MAP_TERRAINS as readonly string[]).includes(terrain))
      return `cell ${key} has unknown terrain`;
  }
  for (const key of blob.roads as unknown[]) {
    if (typeof key !== "string" || !keyInBounds(key, width, height)) return `road ${String(key)} out of bounds`;
  }
  const labels = blob.v === 2 || blob.v === 3 || blob.v === 4 ? blob.labels : undefined;
  if (labels !== undefined) {
    if (!Array.isArray(labels)) return "cells.labels must be an array";
    if (labels.length > MAP_MAX_LABELS) return `too many labels (max ${MAP_MAX_LABELS})`;
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i] as Record<string, unknown>;
      if (typeof l !== "object" || l === null || !isInt(l.x) || !isInt(l.y))
        return `label ${i} has bad coordinates`;
      if ((l.x as number) < 0 || (l.y as number) < 0 || (l.x as number) >= width || (l.y as number) >= height)
        return `label ${i} out of bounds`;
      if (typeof l.text !== "string" || !l.text.trim() || l.text.trim().length > MAP_MAX_LABEL_TEXT)
        return `label ${i} has bad text`;
    }
  }
  if (blob.v === 3 || blob.v === 4) {
    const rooms = (blob as Record<string, unknown>).rooms;
    if (rooms !== undefined) {
      if (!Array.isArray(rooms)) return "cells.rooms must be an array";
      if (rooms.length > MAP_MAX_ROOMS) return `too many rooms (max ${MAP_MAX_ROOMS})`;
      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i] as Record<string, unknown>;
        if (typeof r !== "object" || r === null || !isInt(r.x) || !isInt(r.y) || !isInt(r.w) || !isInt(r.h))
          return `room ${i} has bad geometry`;
        if ((r.x as number) < 0 || (r.y as number) < 0 || (r.w as number) < 1 || (r.h as number) < 1)
          return `room ${i} has bad geometry`;
        if ((r.x as number) + (r.w as number) > width || (r.y as number) + (r.h as number) > height)
          return `room ${i} out of bounds`;
        if (typeof r.type !== "string" || !(MAP_ROOM_TYPES as readonly string[]).includes(r.type))
          return `room ${i} has unknown type`;
        if (typeof r.name !== "string" || r.name.length > MAP_MAX_ROOM_NAME)
          return `room ${i} has bad name`;
      }
    }
    const doors = (blob as Record<string, unknown>).doors;
    if (doors !== undefined) {
      if (!Array.isArray(doors)) return "cells.doors must be an array";
      if (doors.length > MAP_MAX_DOORS) return `too many doors (max ${MAP_MAX_DOORS})`;
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i] as Record<string, unknown>;
        if (typeof d !== "object" || d === null || !isInt(d.x) || !isInt(d.y))
          return `door ${i} has bad coordinates`;
        if ((d.x as number) < 0 || (d.y as number) < 0 || (d.x as number) >= width || (d.y as number) >= height)
          return `door ${i} out of bounds`;
        if (typeof d.edge !== "string" || !(MAP_DOOR_EDGES as readonly string[]).includes(d.edge))
          return `door ${i} has bad edge`;
        if (typeof d.kind !== "string" || !(MAP_DOOR_KINDS as readonly string[]).includes(d.kind))
          return `door ${i} has unknown kind`;
        if (d.secret !== undefined && typeof d.secret !== "boolean") return `door ${i} has bad secret flag`;
        if (d.pair !== undefined && d.pair !== null && typeof d.pair !== "string")
          return `door ${i} has bad pair`;
      }
    }
    const traps = (blob as Record<string, unknown>).traps;
    if (traps !== undefined) {
      if (!Array.isArray(traps)) return "cells.traps must be an array";
      if (traps.length > MAP_MAX_TRAPS) return `too many traps (max ${MAP_MAX_TRAPS})`;
      for (let i = 0; i < traps.length; i++) {
        const t = traps[i] as Record<string, unknown>;
        if (typeof t !== "object" || t === null || !isInt(t.x) || !isInt(t.y))
          return `trap ${i} has bad coordinates`;
        if ((t.x as number) < 0 || (t.y as number) < 0 || (t.x as number) >= width || (t.y as number) >= height)
          return `trap ${i} out of bounds`;
        if (typeof t.kind !== "string" || !(MAP_TRAP_KINDS as readonly string[]).includes(t.kind))
          return `trap ${i} has unknown kind`;
      }
    }
    const markers = (blob as Record<string, unknown>).markers;
    if (markers !== undefined) {
      if (blob.v !== 4) return "cells.markers needs v4";
      if (!Array.isArray(markers)) return "cells.markers must be an array";
      if (markers.length > MAP_MAX_MARKERS) return `too many markers (max ${MAP_MAX_MARKERS})`;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i] as Record<string, unknown>;
        if (typeof m !== "object" || m === null || !isInt(m.x) || !isInt(m.y))
          return `marker ${i} has bad coordinates`;
        if ((m.x as number) < 0 || (m.y as number) < 0 || (m.x as number) >= width || (m.y as number) >= height)
          return `marker ${i} out of bounds`;
        if (typeof m.kind !== "string" || !(MAP_MARKER_KINDS as readonly string[]).includes(m.kind))
          return `marker ${i} has unknown kind`;
      }
    }
    for (const key of ["start", "finish"] as const) {
      const p = (blob as Record<string, unknown>)[key];
      if (p === undefined || p === null) continue;
      if (typeof p !== "object" || !isInt((p as Record<string, unknown>).x) || !isInt((p as Record<string, unknown>).y))
        return `${key} has bad coordinates`;
      const px = (p as unknown as { x: number; y: number }).x;
      const py = (p as unknown as { x: number; y: number }).y;
      if (px < 0 || py < 0 || px >= width || py >= height) return `${key} out of bounds`;
    }
  }
  return null;
}

export interface MapCreateInput {
  name?: unknown;
  grid?: unknown;
  scale?: unknown;
  width?: unknown;
  height?: unknown;
  cell_lore?: unknown;
  seed?: unknown;
  sea?: unknown;
  mountains?: unknown;
  forest?: unknown;
  cells?: unknown;
  thumbnail?: unknown;
  player_visible?: unknown;
  parent_map_id?: unknown;
}

export interface ValidMapCreate {
  name: string;
  grid: MapGrid;
  scale: MapScale;
  width: number;
  height: number;
  cell_lore: string;
  seed: number;
  sea: number;
  mountains: number;
  forest: number;
  cells: string;
  thumbnail: string | null;
  player_visible: number;
  parent_map_id: number | null;
}

function fail(msg: string): { error: string } {
  return { error: msg };
}

// Нормализует и проверяет тело POST. Пресет подставляет W/H/cell_lore,
// которых нет в запросе. parentExists — колбэк в db (карта-родитель
// существует?), чтобы чистый модуль не трогал базу.
export function validateMapCreate(
  body: MapCreateInput,
  parentExists: (id: number) => boolean
): { error: string } | { value: ValidMapCreate } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail("name is required");
  if (name.length > 200) return fail("name too long (max 200)");
  if (body.grid !== "square" && body.grid !== "hex") return fail("grid must be 'square' or 'hex'");
  if (!(MAP_SCALES as readonly string[]).includes(body.scale as string))
    return fail("scale must be one of: " + MAP_SCALES.join(", "));
  const scale = body.scale as MapScale;
  const preset = MAP_SCALE_PRESETS[scale];

  const width = body.width === undefined ? preset.width : body.width;
  const height = body.height === undefined ? preset.height : body.height;
  if (!isInt(width) || width < MAP_MIN_SIDE || width > MAP_MAX_SIDE)
    return fail(`width must be an integer ${MAP_MIN_SIDE}..${MAP_MAX_SIDE}`);
  if (!isInt(height) || height < MAP_MIN_SIDE || height > MAP_MAX_SIDE)
    return fail(`height must be an integer ${MAP_MIN_SIDE}..${MAP_MAX_SIDE}`);

  const cellLore = body.cell_lore === undefined ? preset.cellLore : body.cell_lore;
  if (typeof cellLore !== "string" || cellLore.length > 64) return fail("cell_lore must be a string (max 64)");

  const numOr = (v: unknown, dflt: number) => (v === undefined ? dflt : v);
  const seed = numOr(body.seed, 0);
  const sea = numOr(body.sea, 55);
  const mountains = numOr(body.mountains, 12);
  const forest = numOr(body.forest, 30);
  if (!isInt(seed)) return fail("seed must be an integer");
  if (!isInt(sea) || sea < 20 || sea > 80) return fail("sea must be an integer 20..80");
  if (!isInt(mountains) || mountains < 0 || mountains > 40)
    return fail("mountains must be an integer 0..40");
  if (!isInt(forest) || forest < 0 || forest > 60) return fail("forest must be an integer 0..60");

  const cells = body.cells === undefined ? JSON.stringify(emptyCellsBlob()) : body.cells;
  const cellsError = validateCellsBlob(cells, width, height);
  if (cellsError) return fail(cellsError);

  let thumbnail: string | null = null;
  if (body.thumbnail !== undefined && body.thumbnail !== null) {
    if (!isThumbnail(body.thumbnail)) return fail("thumbnail must be a PNG data URL");
    thumbnail = body.thumbnail;
  }

  let parentMapId: number | null = null;
  if (body.parent_map_id !== undefined && body.parent_map_id !== null) {
    if (!isInt(body.parent_map_id)) return fail("parent_map_id must be an integer");
    if (!parentExists(body.parent_map_id)) return fail("parent map not found");
    parentMapId = body.parent_map_id;
  }

  return {
    value: {
      name,
      grid: body.grid,
      scale,
      width,
      height,
      cell_lore: cellLore,
      seed,
      sea,
      mountains,
      forest,
      cells: cells as string,
      thumbnail,
      player_visible: body.player_visible ? 1 : 0,
      parent_map_id: parentMapId,
    },
  };
}
