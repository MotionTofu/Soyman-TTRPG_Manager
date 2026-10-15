import { CRYPT_GRIME, cryptSide } from "./assets/crypt";
import { tokenTapeImage } from "./assets/tokenTape";
import { drawCachedWalls } from "./assets/wallRasterCache";
import { drawTerrainMaskTiles } from "./assets/terrainMaskDrawing";
import { maskSampleCode } from "./terrainMaskTiles";
import { artworkImage, doorImage, paperPattern, patternSource, stripImage, surfaceImage, surfacePattern, texturedMask, wallPattern, type ArtPack } from "./assets/artwork";
import { drawWallPolyline } from "./assets/wallArtwork";
import { deckKey, fencePostId, villageId } from "./assets/village";
import { ownDeck, ownLinePost, ownPackOf } from "./assets/ownPacks";
import { labelBox, labelFamily } from "./labelStyle";
import { drawWaterStill, waterStillReady, type MapWater } from "./water";
import { LIQUID_LAYER } from "./workspace/liquids";
import { cutKey, cutRoad, drawCrossingDraft, paintedWaterAt, roadCrossings, type RoadCut } from "./crossings";
// Рендер карты на canvas 2D. Цвета террейна — фиксированная спокойная
// палитра (исключение как у Полотна §6 design_revision.md: бюджет акцента
// на неё не тратится). Обрамление (фон, сетка, координаты, дороги) — из
// токенов текущей темы, читаются один раз за кадр.

import { cellCenter, cellCorners, coordLabel, neighbors, worldBounds } from "./grid";
import { createV5RenderModel } from "./renderModel";
import { drawCachedMapSymbol, drawCachedMapImage } from "./assets/draw";
import { buildTerrainMaskRaster } from "./terrainMaskRaster";
import { flattenSplineWithWidths } from "./core/spline";
import type { SplineNode } from "./core/types";
import type {
  MapRenderModel,
  RenderDoor,
  RenderLabel,
  RenderMarker,
  RenderPath,
  RenderRoom,
  RenderStartFinish,
  RenderTerrainLayer,
  RenderTrap,
} from "./renderModel";
import type { MapDocumentV5 } from "./core/types";
import type { MapGrid, MapScale } from "./mapTypes";
import { MAP_TERRAIN_CODES } from "@shared/maps/core/literals";
import {
  MAP_DOOR_KINDS,
  MAP_MARKER_KINDS,
  MAP_ROOM_TYPES,
  MAP_TRAP_KINDS,
} from "@shared/maps/core/literals";

// Порядок — как кисти в тулбаре (канонический список — shared literals,
// single source of truth с server-валидацией; здесь — совместимое имя).
export const MAP_TERRAIN_ORDER = MAP_TERRAIN_CODES;

export const MAP_TERRAIN_FILL: Record<string, string> = {
  deep_water: "#5E8CA3",
  shallow_water: "#93BCC7",
  plain: "#C2B489",
  forest: "#75946F",
  hills: "#A89A7C",
  mountains: "#847C6F",
  desert: "#D3BC87",
  ice: "#D8E2DF",
  // Болото — илистое тёмно-бирюзовое (P1-4): прежнее #7E9070 сливалось с лесом
  // (dLum 0.006, дейтеранопия 0.017). Новое: разрыв тона 48°, dLum 0.078,
  // дейтеранопия 0.067, насыщенность 0.14 — в духе спокойной палитры.
  swamp: "#5F7D72",
  // Опасные воды, пакет D (числа в отчёте): лава тёмно-ржавая, кислота
  // пыльно-жёлтая, яд припылённо-фиолетовый. Только руками (генератор их
  // не ставит). Слабины — в ЧБ против гор/холмов, их кроют разные мотивы.
  lava: "#9C5A41",
  acid: "#A8A35C",
  poison: "#9A8AA8",
  // Стена данжа, пакет C: тёмная тёпло-серая (lum ~0.03 — темнее всего).
  // В кистях её нет (стены ставит данж, стирает ластик), в легенде есть.
  wall: "#2E2A26",
  // Полы и тёмные биомы, Этап B (числа — в отчёте; все спокойные, не accent/неон).
  // Камень — холодный сине-серый: от тёплых холмов/гор отрывается тоном, не яркостью.
  stone: "#7C8B90",
  wood: "#8F6E4E",
  earth: "#5D5040",
  // Тьма — чистый чёрный по решению владельца (со стеной различается почти только
  // звёздами и легендой — цена зафиксирована); некро — тёмно-серая с черепом.
  darkness: "#000000",
  necro: "#4E4A52",
};

type TerrainMaskView = NonNullable<RenderTerrainLayer["terrain"]["mask"]>;
interface TerrainMaskBitmap {
  mapWidth: number;
  mapHeight: number;
  minSX: number;
  minSY: number;
  canvas: HTMLCanvasElement;
}
const terrainMaskBitmaps = new WeakMap<object, WeakMap<object, TerrainMaskBitmap>>();

function terrainMaskBitmap(mask: TerrainMaskView, mapWidth: number, mapHeight: number, palette: Readonly<Record<string, string>>): TerrainMaskBitmap | null {
  const cached = terrainMaskBitmaps.get(mask)?.get(palette);
  if (cached && cached.mapWidth === mapWidth && cached.mapHeight === mapHeight) return cached;
  const raster = buildTerrainMaskRaster(mask, mapWidth, mapHeight, palette, true);
  if (!raster) return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(raster.width, raster.height);
  image.data.set(raster.pixels);
  context.putImageData(image, 0, 0);
  const bitmap = { mapWidth, mapHeight, minSX: raster.minSX, minSY: raster.minSY, canvas };
  let palettes = terrainMaskBitmaps.get(mask);
  if (!palettes) { palettes = new WeakMap(); terrainMaskBitmaps.set(mask, palettes); }
  palettes.set(palette, bitmap);
  return bitmap;
}

export const MAP_TERRAIN_LABELS: Record<string, string> = {
  deep_water: "Глубокая вода",
  shallow_water: "Мелкая вода",
  plain: "Равнина",
  forest: "Лес",
  hills: "Холмы",
  mountains: "Горы",
  desert: "Пустыня",
  ice: "Лёд",
  swamp: "Болото",
  lava: "Лава",
  acid: "Кислота",
  poison: "Яд",
  wall: "Стена",
  stone: "Каменный пол",
  wood: "Деревянный пол",
  earth: "Земляной пол",
  darkness: "Тьма",
  necro: "Некроземля",
};

// Штриховка террейна, пакет B: тип считывается формой, а не только цветом
// (§7 revision: ЧБ-печать и дальтонизм). Мотив на клетку, порог — scale 16.
// На тёмных заливках мотив светлый (бумага), на светлых — чернила.
function hexLum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

const PATTERN_ON_DARK: Record<string, boolean> = Object.fromEntries(
  Object.entries(MAP_TERRAIN_FILL).map(([k, v]) => [k, hexLum(v) < 0.32])
);

// Чернила мотива для легенд (PNG/миниатюры): светлое на тёмном, тёмное на светлом.
export function terrainMotifInk(terrain: string, chrome: MapChrome): string {
  return PATTERN_ON_DARK[terrain] ? chrome.paper : chrome.ink;
}

export function drawTerrainMotif(
  ctx: CanvasRenderingContext2D,
  terrain: string,
  px: number,
  py: number,
  scale: number
): void {
  const u = scale;
  const dot = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
  };
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (terrain) {
    case "deep_water":
    case "shallow_water": {
      // Волна: два горба.
      const w = terrain === "deep_water" ? 0.52 * u : 0.4 * u;
      ctx.beginPath();
      ctx.moveTo(px - w / 2, py);
      ctx.quadraticCurveTo(px - w / 4, py - 0.12 * u, px, py);
      ctx.quadraticCurveTo(px + w / 4, py + 0.12 * u, px + w / 2, py);
      ctx.stroke();
      break;
    }
    case "forest": {
      // Сосна: ствол + два яруса.
      seg(px, py - 0.28 * u, px, py + 0.3 * u);
      seg(px, py - 0.28 * u, px - 0.2 * u, py - 0.05 * u);
      seg(px, py - 0.28 * u, px + 0.2 * u, py - 0.05 * u);
      seg(px, py - 0.08 * u, px - 0.24 * u, py + 0.16 * u);
      seg(px, py - 0.08 * u, px + 0.24 * u, py + 0.16 * u);
      break;
    }
    case "hills": {
      // Две горизонтали рельефа.
      seg(px - 0.26 * u, py - 0.1 * u, px + 0.1 * u, py - 0.1 * u);
      seg(px - 0.1 * u, py + 0.12 * u, px + 0.26 * u, py + 0.12 * u);
      break;
    }
    case "mountains": {
      // Пик-шеврон.
      seg(px - 0.26 * u, py + 0.14 * u, px, py - 0.2 * u);
      seg(px, py - 0.2 * u, px + 0.26 * u, py + 0.14 * u);
      break;
    }
    case "desert": {
      dot(px - 0.16 * u, py - 0.1 * u, 0.05 * u);
      dot(px + 0.14 * u, py - 0.02 * u, 0.05 * u);
      dot(px - 0.02 * u, py + 0.16 * u, 0.05 * u);
      break;
    }
    case "ice": {
      // Искра-крест.
      seg(px - 0.2 * u, py, px + 0.2 * u, py);
      seg(px, py - 0.2 * u, px, py + 0.2 * u);
      break;
    }
    case "swamp": {
      // Три былинки.
      seg(px - 0.18 * u, py + 0.2 * u, px - 0.18 * u, py - 0.12 * u);
      seg(px, py + 0.2 * u, px, py - 0.2 * u);
      seg(px + 0.18 * u, py + 0.2 * u, px + 0.18 * u, py - 0.12 * u);
      break;
    }
    case "lava": {
      // Двойная волна (одинарная — у воды).
      for (const dy of [-0.12 * u, 0.12 * u]) {
        const w = 0.44 * u;
        ctx.beginPath();
        ctx.moveTo(px - w / 2, py + dy);
        ctx.quadraticCurveTo(px - w / 4, py + dy - 0.1 * u, px, py + dy);
        ctx.quadraticCurveTo(px + w / 4, py + dy + 0.1 * u, px + w / 2, py + dy);
        ctx.stroke();
      }
      break;
    }
    case "acid": {
      // Пузыри-кольца (у пустыни — залитые точки).
      for (const [dx, dy, r] of [[-0.16, -0.08, 0.09], [0.14, -0.04, 0.07], [-0.02, 0.14, 0.08]] as const) {
        ctx.beginPath();
        ctx.arc(px + dx * u, py + dy * u, Math.max(1, r * u), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "poison": {
      // Кольцо с точкой.
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.5, 0.2 * u), 0, Math.PI * 2);
      ctx.stroke();
      dot(px, py, 0.05 * u);
      break;
    }
    case "wall": {
      // Кирпич: два ряда + швы.
      seg(px - 0.26 * u, py - 0.1 * u, px + 0.26 * u, py - 0.1 * u);
      seg(px - 0.26 * u, py + 0.12 * u, px + 0.26 * u, py + 0.12 * u);
      seg(px - 0.08 * u, py - 0.1 * u, px - 0.08 * u, py + 0.01 * u);
      seg(px + 0.12 * u, py + 0.01 * u, px + 0.12 * u, py + 0.12 * u);
      break;
    }
    case "stone": {
      // Тёсаные блоки: четыре квадрата (у пустыни — круги, не перепутать).
      const s = Math.max(1, 0.09 * u);
      ctx.fillRect(px - 0.2 * u - s / 2, py - 0.2 * u - s / 2, s, s);
      ctx.fillRect(px + 0.2 * u - s / 2, py - 0.2 * u - s / 2, s, s);
      ctx.fillRect(px - 0.2 * u - s / 2, py + 0.2 * u - s / 2, s, s);
      ctx.fillRect(px + 0.2 * u - s / 2, py + 0.2 * u - s / 2, s, s);
      break;
    }
    case "wood": {
      // Планки: две вертикали во всю клетку.
      seg(px - 0.14 * u, py - 0.3 * u, px - 0.14 * u, py + 0.3 * u);
      seg(px + 0.14 * u, py - 0.3 * u, px + 0.14 * u, py + 0.3 * u);
      break;
    }
    case "earth": {
      // Редкая сыпь: точка + чёрточка (у пустыни — треугольник из трёх точек).
      dot(px - 0.12 * u, py - 0.08 * u, 0.05 * u);
      seg(px + 0.02 * u, py + 0.12 * u, px + 0.2 * u, py + 0.12 * u);
      break;
    }
    case "darkness": {
      // Звёзды: три мини-креста (у льда — один крупный).
      for (const [dx, dy] of [[-0.16, -0.1], [0.12, -0.14], [0, 0.16]] as const) {
        const cx = px + dx * u;
        const cy = py + dy * u;
        const a = Math.max(1, 0.06 * u);
        seg(cx - a, cy, cx + a, cy);
        seg(cx, cy - a, cx, cy + a);
      }
      break;
    }
    case "necro": {
      // Череп-знак: кольцо + два глаза.
      ctx.beginPath();
      ctx.arc(px, py - 0.02 * u, Math.max(1.5, 0.17 * u), 0, Math.PI * 2);
      ctx.stroke();
      dot(px - 0.06 * u, py - 0.05 * u, 0.035 * u);
      dot(px + 0.06 * u, py - 0.05 * u, 0.035 * u);
      break;
    }
    default:
      break; // равнина — чистая
  }
}

// Порядок кистей — пресет масштаба (грилинг Q18): сверху то, чем этот
// масштаб красят в 90% случаев. Все 10 доступны везде. "road" — бит-оверлей,
// а не террейн, но в тулбаре стоит в том же ряду.
export const MAP_TOOL_ORDER: Record<MapScale, ((typeof MAP_TERRAIN_ORDER)[number] | "road")[]> = {
  planet: ["deep_water", "shallow_water", "plain", "mountains", "ice", "forest", "hills", "desert", "swamp", "lava", "acid", "poison", "darkness", "necro", "road"],
  continent: ["shallow_water", "plain", "forest", "hills", "mountains", "deep_water", "desert", "ice", "swamp", "lava", "acid", "poison", "darkness", "necro", "road"],
  country: ["shallow_water", "plain", "forest", "hills", "mountains", "deep_water", "desert", "ice", "swamp", "lava", "acid", "poison", "darkness", "necro", "road"],
  region: ["shallow_water", "plain", "forest", "hills", "mountains", "deep_water", "desert", "ice", "swamp", "lava", "acid", "poison", "darkness", "necro", "stone", "wood", "earth", "road"],
  settlement: ["road", "plain", "forest", "shallow_water", "hills", "deep_water", "mountains", "desert", "ice", "swamp", "darkness", "necro", "stone", "wood", "earth"],
  locality: ["road", "plain", "forest", "shallow_water", "hills", "deep_water", "mountains", "desert", "ice", "swamp", "darkness", "necro", "stone", "wood", "earth"],
};

// Раскладка тулбара по панелям (Этап F): биомы — природная краска,
// полы — рукотворная поверхность (стены/дороги/реки — отдельные кнопки, не свотчи).
export const MAP_BIOME_TERRAINS: (typeof MAP_TERRAIN_ORDER)[number][] = [
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
  "darkness",
  "necro",
];
export const MAP_FLOOR_TERRAINS: (typeof MAP_TERRAIN_ORDER)[number][] = ["stone", "wood", "earth"];

// Слой объектов, пакет A (спека Объекты_спек.md): комнаты-сущности, двери на
// рёбрах, ловушки, старт/финиш. Рёбра пока только квадраты (n/s/e/w),
// гексы — следующим шагом слоя.

export { MAP_DOOR_KINDS, MAP_MARKER_KINDS, MAP_ROOM_TYPES, MAP_TRAP_KINDS };
export type MapRoomType = (typeof MAP_ROOM_TYPES)[number];

export const MAP_ROOM_LABELS: Record<MapRoomType, string> = {
  empty: "Пустая",
  barracks: "Казарма",
  temple: "Храм",
  treasury: "Сокровищница",
  prison: "Темница",
  lab: "Лаборатория",
};

// Тинт типа поверх террейна (приглушено, в духе спокойной палитры §7).
// Пустая — без тинта.
export const MAP_ROOM_TINT: Record<MapRoomType, string | null> = {
  empty: null,
  barracks: "#e8dcc8",
  temple: "#dde8ff",
  treasury: "#fff2b3",
  prison: "#e0d0d0",
  lab: "#d8f0d8",
};

export type MapDoorKind = (typeof MAP_DOOR_KINDS)[number];
export type MapDoorEdge = "n" | "s" | "e" | "w";

export const MAP_DOOR_LABELS: Record<MapDoorKind, string> = {
  arch: "Арка",
  door: "Дверь",
  locked: "Заперта",
  trapped: "Ловушка",
  secret: "Секрет",
  portc: "Решётка",
};

export const MAP_DOOR_GLYPHS: Record<MapDoorKind, string> = {
  arch: "○",
  door: "◫",
  locked: "⚿",
  trapped: "⚠",
  secret: "S",
  portc: "▦",
};

// Заливки видов приглушены относительно прототипа (тот неон — не наша палитра).
export const MAP_DOOR_FILL: Record<MapDoorKind, string> = {
  arch: "#9dc8a8",
  door: "#e8b04b",
  locked: "#d98a94",
  trapped: "#e09a6a",
  secret: "#93b8d4",
  portc: "#b3a4cc",
};

export type MapTrapKind = (typeof MAP_TRAP_KINDS)[number];
export const MAP_TRAP_LABELS: Record<MapTrapKind, string> = {
  pit: "Яма",
  arrow: "Стрелы",
  gas: "Газ",
  glyph: "Глиф",
};

export const MAP_TRAP_GLYPHS: Record<MapTrapKind, string> = {
  pit: "◉",
  arrow: "➤",
  gas: "☠",
  glyph: "✦",
};

// Цвет/подпись реки — один источник на поле, легенды и превью (Этап A).
export const MAP_RIVER_FILL = "#4E7E96";
export const MAP_RIVER_LABEL = "Река";

export interface MapRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  type: MapRoomType;
  name: string;
}

export interface MapDoor {
  x: number;
  y: number;
  edge: MapDoorEdge;
  kind: MapDoorKind;
  secret: boolean;
  pair: string | null;
}

export interface MapTrap {
  x: number;
  y: number;
  kind: MapTrapKind;
}

// Маркеры-точки, blob v4 (сундуки, алтари; задел под NPC из M5).
// Поселения и POI (Этап A+): город/деревня/лагерь/метрополия/битва/обелиск.
// В отличие от ловушек — видимы игрокам (как комнаты).
export type MapMarkerKind = (typeof MAP_MARKER_KINDS)[number];

export interface MapMarker {
  x: number;
  y: number;
  kind: MapMarkerKind;
}

export const MAP_MARKER_LABELS: Record<MapMarkerKind, string> = {
  chest: "Сундук",
  altar: "Алтарь",
  city: "Город",
  village: "Деревня",
  camp: "Лагерь",
  metro: "Большой город",
  battle: "Место битвы",
  obelisk: "Обелиск",
};

// Глифы для HTML-легенды (на поле — рисованные фигуры, см. ниже).
export const MAP_MARKER_GLYPHS: Record<MapMarkerKind, string> = {
  chest: "▣",
  altar: "○",
  city: "◆",
  village: "⌂",
  camp: "△",
  metro: "◈",
  battle: "✕",
  obelisk: "▮",
};

export interface MapLabel {
  x: number;
  y: number;
  text: string;
}

export interface MapCells {
  terrain: Map<string, string>; // "x,y" -> код террейна (нет записи = равнина)
  roads: Set<string>; // "x,y" с дорогой поверх террейна
  rivers: Set<string>; // "x,y" с рекой поверх террейна, под дорогами (blob v4+)
  labels: MapLabel[]; // подписи (blob v2+; v1 читается как пустой список)
  rooms: MapRoom[]; // blob v3+
  doors: MapDoor[]; // blob v3+
  traps: MapTrap[]; // blob v3+
  markers: MapMarker[]; // blob v4+
  start: { x: number; y: number } | null; // blob v3+
  finish: { x: number; y: number } | null; // blob v3+
}

export const MAP_MAX_LABELS = 200;
export const MAP_MAX_LABEL_TEXT = 64;
export const MAP_MAX_ROOMS = 100;
export const MAP_MAX_DOORS = 400;
export const MAP_MAX_TRAPS = 300;
export const MAP_MAX_MARKERS = 300;
export const MAP_MAX_ROOM_NAME = 64;

function emptyCells(): MapCells {
  return { terrain: new Map(), roads: new Set(), rivers: new Set(), labels: [], rooms: [], doors: [], traps: [], markers: [], start: null, finish: null };
}

function isRoomType(v: unknown): v is MapRoomType {
  return typeof v === "string" && (MAP_ROOM_TYPES as readonly string[]).includes(v);
}

function isDoorKind(v: unknown): v is MapDoorKind {
  return typeof v === "string" && (MAP_DOOR_KINDS as readonly string[]).includes(v);
}

function isTrapKind(v: unknown): v is MapTrapKind {
  return typeof v === "string" && (MAP_TRAP_KINDS as readonly string[]).includes(v);
}

function isMarkerKind(v: unknown): v is MapMarkerKind {
  return typeof v === "string" && (MAP_MARKER_KINDS as readonly string[]).includes(v);
}

export function parseCellsBlob(raw: string): MapCells {
  const out = emptyCells();
  try {
    const blob = JSON.parse(raw) as {
      v?: number;
      cells?: Record<string, string>;
      roads?: string[];
      rivers?: string[];
      labels?: { x?: unknown; y?: unknown; text?: unknown }[];
      rooms?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown; type?: unknown; name?: unknown }[];
      doors?: { x?: unknown; y?: unknown; edge?: unknown; kind?: unknown; secret?: unknown; pair?: unknown }[];
      traps?: { x?: unknown; y?: unknown; kind?: unknown }[];
      markers?: { x?: unknown; y?: unknown; kind?: unknown }[];
      start?: { x?: unknown; y?: unknown };
      finish?: { x?: unknown; y?: unknown };
    };
    if (blob.v !== 1 && blob.v !== 2 && blob.v !== 3 && blob.v !== 4) return out;
    for (const [k, t] of Object.entries(blob.cells ?? {})) out.terrain.set(k, t);
    for (const k of blob.roads ?? []) out.roads.add(k);
    if (blob.v === 4) for (const k of blob.rivers ?? []) out.rivers.add(k);
    // Чужие/битые записи роняем поштучно, а не весь blob: запись на сервере
    // всё равно проходит строгую валидацию, здесь важно не дать белый экран.
    if ((blob.v === 2 || blob.v === 3 || blob.v === 4) && Array.isArray(blob.labels)) {
      for (const l of blob.labels) {
        if (typeof l !== "object" || l === null) continue;
        if (!Number.isInteger(l.x) || !Number.isInteger(l.y)) continue;
        if (typeof l.text !== "string" || !l.text.trim() || l.text.trim().length > MAP_MAX_LABEL_TEXT) continue;
        if ((l.x as number) < 0 || (l.y as number) < 0) continue;
        out.labels.push({ x: l.x as number, y: l.y as number, text: (l.text as string).trim() });
        if (out.labels.length >= MAP_MAX_LABELS) break;
      }
    }
    if (blob.v === 3 || blob.v === 4) {
      if (Array.isArray(blob.rooms)) {
        for (const r of blob.rooms) {
          if (typeof r !== "object" || r === null) continue;
          if (!Number.isInteger(r.x) || !Number.isInteger(r.y) || !Number.isInteger(r.w) || !Number.isInteger(r.h)) continue;
          if ((r.w as number) < 1 || (r.h as number) < 1 || (r.x as number) < 0 || (r.y as number) < 0) continue;
          if (!isRoomType(r.type)) continue;
          const name = typeof r.name === "string" ? r.name.trim().slice(0, MAP_MAX_ROOM_NAME) : "";
          out.rooms.push({ x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number, type: r.type, name });
          if (out.rooms.length >= MAP_MAX_ROOMS) break;
        }
      }
      if (Array.isArray(blob.doors)) {
        for (const d of blob.doors) {
          if (typeof d !== "object" || d === null) continue;
          if (!Number.isInteger(d.x) || !Number.isInteger(d.y)) continue;
          if ((d.x as number) < 0 || (d.y as number) < 0) continue;
          if (d.edge !== "n" && d.edge !== "s" && d.edge !== "e" && d.edge !== "w") continue;
          if (!isDoorKind(d.kind)) continue;
          out.doors.push({
            x: d.x as number,
            y: d.y as number,
            edge: d.edge,
            kind: d.kind,
            secret: d.secret === true,
            pair: typeof d.pair === "string" && d.pair ? d.pair : null,
          });
          if (out.doors.length >= MAP_MAX_DOORS) break;
        }
      }
      if (Array.isArray(blob.traps)) {
        for (const t of blob.traps) {
          if (typeof t !== "object" || t === null) continue;
          if (!Number.isInteger(t.x) || !Number.isInteger(t.y)) continue;
          if ((t.x as number) < 0 || (t.y as number) < 0) continue;
          if (!isTrapKind(t.kind)) continue;
          out.traps.push({ x: t.x as number, y: t.y as number, kind: t.kind });
          if (out.traps.length >= MAP_MAX_TRAPS) break;
        }
      }
      if (blob.v === 4 && Array.isArray(blob.markers)) {
        for (const mk of blob.markers) {
          if (typeof mk !== "object" || mk === null) continue;
          if (!Number.isInteger(mk.x) || !Number.isInteger(mk.y)) continue;
          if ((mk.x as number) < 0 || (mk.y as number) < 0) continue;
          if (!isMarkerKind(mk.kind)) continue;
          out.markers.push({ x: mk.x as number, y: mk.y as number, kind: mk.kind });
          if (out.markers.length >= MAP_MAX_MARKERS) break;
        }
      }
      for (const key of ["start", "finish"] as const) {
        const p = blob[key];
        if (typeof p === "object" && p !== null && Number.isInteger(p.x) && Number.isInteger(p.y) && (p.x as number) >= 0 && (p.y as number) >= 0) {
          out[key] = { x: p.x as number, y: p.y as number };
        }
      }
    }
  } catch {
    // Битый blob = пустая карта, а не белый экран
  }
  return out;
}

export interface MapChrome {
  paper: string;
  line: string;
  muted: string;
  ink: string;
}

// Статус сырого blob для плашки P1-7: строгая проверка здесь, в рендере —
// мягкая (там битое роняется поштучно, чтобы не дать белый экран).
export function cellsBlobStatus(raw: string): "ok" | "corrupt" {
  try {
    const blob = JSON.parse(raw) as { v?: unknown };
    if (typeof blob !== "object" || blob === null) return "corrupt";
    if (blob.v !== 1 && blob.v !== 2 && blob.v !== 3 && blob.v !== 4) return "corrupt";
    return "ok";
  } catch {
    return "corrupt";
  }
}

// Токены темы для обрамления карты. Читаются на каждый кадр — дёшево
// (4 getPropertyValue) и переживают смену темы без подписок.
export function readChrome(): MapChrome {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    paper: get("--paper", "#EDE7D9"),
    line: get("--line", "#12100E"),
    muted: get("--muted", "#6E675C"),
    ink: get("--ink", "#12100E"),
  };
}

// Д-21: canvas не резолвит var() в `ctx.font` — строка с var() целиком
// невалидна, и canvas молча держит предыдущий шрифт (номера комнат,
// координаты и подписи рисовались утекшим шрифтом). Поэтому гарнитуры
// резолвим здесь же через getComputedStyle, как токены выше.
export interface CanvasFonts {
  label: string;
  mono: string;
}

export function readCanvasFonts(): CanvasFonts {
  const css = getComputedStyle(document.documentElement);
  const ui = css.getPropertyValue("--font-ui").trim();
  const mono = css.getPropertyValue("--font-mono").trim();
  return {
    label: `Oswald, ${ui || "sans-serif"}`,
    mono: mono || "monospace",
  };
}

export interface RenderOptions {
  grid: MapGrid;
  width: number;
  height: number;
  // Фаза 2D: read-only view вместо storage-типа MapCells (см. maps/renderModel.ts).
  model: MapRenderModel;
  // Камера: scale = экранных px на мировую единицу, ox/oy = сдвиг в px.
  scale: number;
  ox: number;
  oy: number;
  showGrid: boolean;
  gridColor?: string;
  gridOpacity?: number;
  gridLineWidth?: number;
  gridLineStyle?: "solid" | "dashed";
  showCoords: boolean;
  // Подсветка клетки под курсором (мировые "x,y" или null).
  hover: string | null;
  // Футпринт кисти 2/3 (Этап G): если задан непустым — подсвечивается он, иначе hover.
  hoverCells?: string[] | null;
  chrome: MapChrome;
  /** Optional palette for workspace drawing styles; legacy defaults stay intact. */
  terrainFill?: Readonly<Record<string, string>>;
  fonts?: CanvasFonts;
  /** Optional local artwork for the workspace; the classic renderer stays unchanged. */
  cartography?: boolean;
  /** Чей рисунок у полов, стен и дверей: «Бумага и тушь» или «Склеп» (комикс-панк). */
  artPack?: ArtPack;
  /** Живая вода. На обычном холсте рисуется одним кадром поверх земли; сцена WebGL кладёт её сама и просит карту по частям. */
  water?: MapWater;
  /** Не стирать холст перед отрисовкой: вторая половина карты ложится поверх первой. */
  keep?: boolean;
  /** Поля вокруг карты, клеток; за ними холст закрыт. Без поля карта не ограничена. */
  frame?: number;
  /** Половина карты для сцены с водой-шейдером: «земля» — бумага, поверхности и реки с водой;
   * «над землёй» — всё остальное на прозрачном фоне. Без поля карта рисуется целиком. */
  part?: "ground" | "over";
  // Взгляд игрока (пакет A §6): секретное скрыто, trapped видна обычной дверью.
  playerView: boolean;
  /** Мастер видит полную карту под полупрозрачной подсказкой маски при редактировании. */
  fogGuide?: boolean;
  // Выбранный объект для подсветки — stable EntityId (Фаза 2G, §46).
  selectedId: string | null;
}

// Дверь глазами смотрящего: секрет → скрыть, trapped игроку → обычная.
// Принимает минимальный интерфейс (MapDoor и RenderDoor совместимы структурно).
export function doorForView(
  d: { kind: MapDoorKind; secret: boolean },
  playerView: boolean
): { kind: MapDoorKind; hidden: boolean } {
  if (!playerView) return { kind: d.kind, hidden: false };
  if (d.kind === "secret" || d.secret) return { kind: d.kind, hidden: true };
  if (d.kind === "trapped") return { kind: "door", hidden: false };
  return { kind: d.kind, hidden: false };
}

/** Половине предметов — пятно грязи рядом: вид, сдвиг, поворот и размер из хэша id, поэтому стабильны между кадрами. */
function grimeFor(id: string): { key: string; dx: number; dy: number; angle: number; size: number } | null {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const next = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  if (next() < 0.5) return null;
  const turn = next() * Math.PI * 2;
  return { key: CRYPT_GRIME[Math.floor(next() * CRYPT_GRIME.length)], dx: Math.cos(turn) * 0.45, dy: Math.sin(turn) * 0.45, angle: next() * Math.PI * 2, size: 0.6 + next() * 0.5 };
}

type StripSamples = { key: string; samples: ReturnType<typeof flattenSplineWithWidths>; minX: number; minY: number; maxX: number; maxY: number };
const stripCache = new WeakMap<readonly SplineNode[], StripSamples>();
/** Точки полосы-картинки и её рамка. Карта рисуется плитками, и без запаса длинная дорога
 * раскладывалась заново для каждой плитки, даже той, где её нет (замер 2026-10-08: 5 мс на плитку). */
function stripSamples(nodes: readonly SplineNode[], closed: boolean, width: number, step: number, soft = false): StripSamples {
  const key = `${closed}:${width}:${step}:${soft}`, cached = stripCache.get(nodes);
  if (cached?.key === key) return cached;
  const samples = flattenSplineWithWidths(closed ? [...nodes, nodes[0]] : nodes, width, step);
  if (soft && !closed && samples.length > 1) {
    // Дорога не обрывается ровным срезом: к концу сходит на нет скруглённым языком длиной в свою ширину.
    const arc = [0];
    for (let i = 1; i < samples.length; i++) arc.push(arc[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
    const total = arc[arc.length - 1], ends = [samples[0].width, samples[samples.length - 1].width];
    samples.forEach((sample, i) => {
      const t = Math.min(arc[i] / ends[0], (total - arc[i]) / ends[1], 1);
      if (t < 1) sample.width *= Math.max(0.08, Math.sqrt(t * (2 - t)));
    });
  }
  const reach = Math.max(width, ...samples.map(sample => sample.width)) * 2;
  const xs = samples.map(sample => sample.x), ys = samples.map(sample => sample.y);
  const result = { key, samples, minX: Math.min(...xs) - reach, minY: Math.min(...ys) - reach, maxX: Math.max(...xs) + reach, maxY: Math.max(...ys) + reach };
  stripCache.set(nodes, result); return result;
}
/** Доля ширины полосы дороги без рваных краёв. */
const ROAD_CORE = 0.7;
const roadCuts = new WeakMap<StripSamples["samples"], RoadCut>();
export function renderMap(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number, o: RenderOptions): void {
  const { grid, width, height, model, scale, ox, oy, showGrid, showCoords, hover, chrome, playerView, selectedId } = o;
  const terrainFill = o.terrainFill ?? MAP_TERRAIN_FILL;
  const baseTransform = ctx.getTransform?.();
  const pixelRatio = baseTransform ? Math.max(Math.hypot(baseTransform.a, baseTransform.b), Math.hypot(baseTransform.c, baseTransform.d)) : 1;
  const fonts = o.fonts ?? readCanvasFonts();
  const pack = o.artPack ?? "cartography";
  const dungeon = !!o.cartography && model.layers.some(layer => layer.visible && layer.kind === "terrain" && (layer.terrain.defaultCode === "wall" || (!layer.terrain.mask && [...layer.terrain.entries.values()].includes("wall"))));
  if (o.water && !o.part && waterStillReady()) {
    // Земля, на неё вода, потом всё остальное — мосты, дороги и фишки остаются над водой.
    renderMap(ctx, canvasW, canvasH, { ...o, part: "ground" });
    drawWaterStill(ctx, model, width, height, o.water, canvasW, canvasH, scale, ox, oy, pixelRatio);
    renderMap(ctx, canvasW, canvasH, { ...o, part: "over", keep: true });
    return;
  }
  // Реки, которые лежат под живой водой: река-поверхность и река атласа — её устье накрывает море, как берег.
  const part = o.part, waterRiver = (path: RenderPath) => path.kind === "river" && (!!path.style || path.atlas === "river") && !!path.nodes;
  ctx.save();
  if (!o.keep) ctx.clearRect(0, 0, canvasW, canvasH);
  if (part !== "over") { ctx.fillStyle = chrome.paper; ctx.fillRect(0, 0, canvasW, canvasH); }

  if (part !== "over" && o.cartography && pack === "crypt" && ctx.canvas) {
    const paper = paperPattern(ctx, scale, ox, oy);
    if (paper) { ctx.fillStyle = paper; ctx.fillRect(0, 0, canvasW, canvasH); }
  }

  const X = (wx: number) => ox + wx * scale;
  const Y = (wy: number) => oy + wy * scale;

  // Видимый диапазон клеток (P1-5): за экраном не красим. Запас 1 клетка —
  // гексы соседних колонок заглядывают за свою ось.
  const inView = (x: number, y: number) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
  // Отсев сущностей read-модели (позиции мировые, не клеточные):
  // - square: точный эквивалент поклеточного inView (центр x+.5 в [vx0,vx1+1]
  //   ⟺ целое x в [vx0,vx1]; середины рёбер — аналогично);
  // - hex: консервативный экранный запас 3 единицы (legacy-окно покрывает
  //   центры не дальше ~2.5 клеток за краем + радиус сущности) — видимое
  //   не пропускает никогда, лишнее за экраном пикселей не даёт.
  // Клеточный inView выше остаётся для террейна/сетки/координат.
  const inViewWorld =
    grid === "square"
      ? (px: number, py: number) => px >= vx0 && px <= vx1 + 1 && py >= vy0 && py <= vy1 + 1
      : (px: number, py: number) => {
          const sx = X(px);
          const sy = Y(py);
          const m = scale * 3;
          return sx >= -m && sx <= canvasW + m && sy >= -m && sy <= canvasH + m;
        };
  // У гексов индекс клетки не равен мировой координате: шаг по X — √3,
  // по Y — 1.5. Без этого справа и снизу на увеличенной карте остаются
  // незакрашенные клетки, включая клетки тумана.
  const stepX = grid === "hex" ? Math.sqrt(3) : 1;
  const stepY = grid === "hex" ? 1.5 : 1;
  const margin = grid === "hex" ? 2 : 1;
  const vx0 = Math.max(0, Math.floor(-ox / scale / stepX) - margin);
  const vy0 = Math.max(0, Math.floor(-oy / scale / stepY) - margin);
  const vx1 = Math.min(width - 1, Math.ceil((canvasW - ox) / scale / stepX) + margin);
  const vy1 = Math.min(height - 1, Math.ceil((canvasH - oy) / scale / stepY) + margin);

  const traceCell = (x: number, y: number) => {
    const pts = cellCorners(grid, x, y);
    ctx.beginPath();
    ctx.moveTo(X(pts[0].px), Y(pts[0].py));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].px), Y(pts[i].py));
    ctx.closePath();
  };

  // --- 3A: layer-driven предрасчёты, которым нужен весь стек сразу.
  // Середины рёбер дверей (разрывы обводки комнат) — все видимые gameplay-слои;
  // скрытая дверь у игрока щели не даёт (иначе спойлер позицией).
  const doorPoints = new Set<string>();
  if (grid === "square") {
    for (const layer of model.layers) {
      if (layer.kind !== "gameplay" || !layer.visible) continue;
      for (const it of layer.items) {
        if (it.kind !== "door") continue;
        if (doorForView(it.door, playerView).hidden) continue;
        doorPoints.add(`${it.door.position.x},${it.door.position.y}`);
      }
    }
  }
  // Композитный террейн для wallAt: маска пропускает неокрашенные samples,
  // клеточный слой остаётся полным surface.
  const visibleTerrains = model.layers.filter(
    (l): l is RenderTerrainLayer => l.kind === "terrain" && l.visible,
  );
  const terrainAt = (x: number, y: number): string => {
    for (let i = visibleTerrains.length - 1; i >= 0; i--) {
      const terrain = visibleTerrains[i].terrain;
      const mask = terrain.mask;
      if (mask) {
        const center = cellCenter(grid, x, y);
        const sx = Math.floor((center.cx - mask.origin.x) / mask.sampleSize);
        const sy = Math.floor((center.cy - mask.origin.y) / mask.sampleSize);
        const painted = maskSampleCode(mask, sx, sy);
        if (painted) return painted;
      } else return terrain.entries.get(`${x},${y}`) ?? terrain.defaultCode;
    }
    return visibleTerrains[0]?.terrain.defaultCode ?? "plain";
  };

  // Один terrain-слой — полный surface (§12): default заливает всё поле одним
  // проходом, поверх — только расписанные и только видимые клетки.
  const artworkPatterns = new Map<string, CanvasPattern | null>();
  const paintArtwork = (code: string, fill: () => void) => {
    if (!o.cartography || !ctx.canvas || typeof document === "undefined") return;
    let pattern = artworkPatterns.get(code);
    if (pattern === undefined) {
      const image = surfaceImage(code, dungeon, pack);
      // В комикс-панке толща скалы — сплошная тушь, без штриховки.
      pattern = code === "wall" ? (pack === "crypt" ? null : wallPattern(ctx, scale, ox, oy)) : image ? surfacePattern(ctx, image, scale, ox, oy, pack) : null;
      artworkPatterns.set(code, pattern);
    }
    if (!pattern) return;
    ctx.save(); ctx.globalAlpha *= pack === "crypt" ? 1 : 0.65; ctx.fillStyle = pattern; fill(); ctx.restore();
  };
  const fillTerrainDefault = (defaultCode: string) => {
    ctx.fillStyle = terrainFill[defaultCode] ?? terrainFill.plain;
    if (grid === "square") {
      ctx.fillRect(X(0), Y(0), width * scale, height * scale);
      paintArtwork(defaultCode, () => ctx.fillRect(X(0), Y(0), width * scale, height * scale));
    } else {
      for (let y = vy0; y <= vy1; y++)
        for (let x = vx0; x <= vx1; x++) {
          traceCell(x, y);
          ctx.fill();
          paintArtwork(defaultCode, () => ctx.fill());
        }
    }
  };
  const fillTerrainEntries = (entries: ReadonlyMap<string, string>, defaultCode: string) => {
    const byTerrain = new Map<string, { x: number; y: number }[]>();
    for (const [key, t] of entries) {
      const [x, y] = key.split(",").map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) continue;
      if (t === defaultCode || !inView(x, y)) continue;
      const list = byTerrain.get(t) ?? [];
      list.push({ x, y });
      byTerrain.set(t, list);
    }
    for (const [t, list] of byTerrain) {
      ctx.fillStyle = terrainFill[t] ?? terrainFill[defaultCode] ?? terrainFill.plain;
      for (const { x, y } of list) {
        traceCell(x, y);
        ctx.fill();
        paintArtwork(t, () => ctx.fill());
      }
    }
  };

  const fillTerrainMask = (mask: NonNullable<RenderTerrainLayer["terrain"]["mask"]>) => {
    if (mask.source ? mask.source.chunks.length === 0 : mask.entries.size === 0) return;
    if (mask.source && ctx.canvas && typeof document !== "undefined") {
      drawTerrainMaskTiles(ctx, mask, width, height, canvasW, canvasH, scale, ox, oy, pixelRatio, terrainFill, pack, !!o.cartography);
      return;
    }
    const bitmap = ctx.canvas && typeof document !== "undefined"
      ? terrainMaskBitmap(mask, width, height, o.terrainFill ?? MAP_TERRAIN_FILL) : null;
    if (bitmap) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(0), Y(0), width * scale, height * scale);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        bitmap.canvas,
        X(mask.origin.x + bitmap.minSX * mask.sampleSize),
        Y(mask.origin.y + bitmap.minSY * mask.sampleSize),
        bitmap.canvas.width * mask.sampleSize * scale,
        bitmap.canvas.height * mask.sampleSize * scale,
      );
      if (o.cartography) {
        const codes = mask.source ? mask.source.codes.filter((code): code is string => !!code) : [...new Set(mask.entries.values())];
        const byImage = new Map<HTMLImageElement, string[]>();
        for (const code of new Set(codes)) {
          const image = surfaceImage(code, false, pack); if (!image) continue;
          const group = byImage.get(image) ?? []; group.push(code); byImage.set(image, group);
        }
        for (const [image, materials] of byImage) {
          const texture = texturedMask(mask, materials, image, width, height, pack);
          if (!texture) continue;
          ctx.save(); ctx.globalAlpha *= pack === "crypt" ? 1 : 0.65;
          ctx.drawImage(texture.canvas, X(texture.x), Y(texture.y), texture.w * scale, texture.h * scale); ctx.restore();
        }
      }
      ctx.restore();
      return;
    }
    const size = mask.sampleSize;
    const minSX = Math.floor((Math.max(0, -ox / scale) - mask.origin.x) / size);
    const maxSX = Math.ceil((Math.min(width, (canvasW - ox) / scale) - mask.origin.x) / size) - 1;
    const minSY = Math.floor((Math.max(0, -oy / scale) - mask.origin.y) / size);
    const maxSY = Math.ceil((Math.min(height, (canvasH - oy) / scale) - mask.origin.y) / size) - 1;
    if (maxSX < minSX || maxSY < minSY) return;
    const drawRun = (sx: number, endSX: number, sy: number, code: string) => {
      const left = Math.max(0, mask.origin.x + sx * size);
      const top = Math.max(0, mask.origin.y + sy * size);
      const right = Math.min(width, mask.origin.x + endSX * size);
      const bottom = Math.min(height, mask.origin.y + (sy + 1) * size);
      if (right <= left || bottom <= top) return;
      ctx.fillStyle = terrainFill[code] ?? terrainFill.plain;
      ctx.fillRect(X(left), Y(top), (right - left) * scale, (bottom - top) * scale);
    };
    const visibleArea = (maxSX - minSX + 1) * (maxSY - minSY + 1);
    if (mask.entries.size < visibleArea / 4) {
      // Sparse paint: traverse only stored samples.
      for (const [key, code] of mask.entries) {
        const [sx, sy] = key.split(",").map(Number);
        if (sx < minSX || sx > maxSX || sy < minSY || sy > maxSY) continue;
        drawRun(sx, sx + 1, sy, code);
      }
      return;
    }
    // Dense fill: combine adjacent equal samples into one Canvas rectangle.
    for (let sy = minSY; sy <= maxSY; sy++) {
      let runCode: string | undefined;
      let runStart = minSX;
      for (let sx = minSX; sx <= maxSX + 1; sx++) {
        const code = sx <= maxSX ? mask.entries.get(`${sx},${sy}`) : undefined;
        if (code === runCode) continue;
        if (runCode !== undefined) drawRun(runStart, sx, sy, runCode);
        runCode = code;
        runStart = sx;
      }
    }
  };

  const drawWallEdges = (terrain: RenderTerrainLayer["terrain"]) => {
    if (!o.cartography || grid !== "square") return;
    const walls = terrain.entries;
    const at = (x: number, y: number) => walls.get(`${x},${y}`) ?? terrain.defaultCode;
    const image = pack === "crypt" ? artworkImage("wall-masonry", "crypt") : artworkImage("stone-wall");
    // Участок кладки повторяется вдоль ребра; толщина — 0.36 клетки, длина участка — по пропорции рисунка.
    const brick = pack === "crypt" && image ? patternSource(image, 0.36 * scale / image.naturalHeight) : null;
    const masonry = brick ? ctx.createPattern(brick.source, "repeat-x") : null;
    for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) {
      if (at(x, y) !== "wall") continue;
      for (const [dx, dy, angle] of [[0, -1, 0], [1, 0, 90], [0, 1, 180], [-1, 0, 270]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || at(nx, ny) === "wall") continue;
        if (pack === "crypt") {
          const t = 0.36 * scale;
          ctx.save(); ctx.translate(X(x + 0.5 + dx * 0.32), Y(y + 0.5 + dy * 0.32)); ctx.rotate(angle * Math.PI / 180);
          if (masonry && image) {
            const k = t / image.naturalHeight;
            // Привязка к миру по длине ребра, иначе соседние участки начинаются одинаково.
            masonry.setTransform(new DOMMatrix([k * brick!.factor, 0, 0, k * brick!.factor, -((angle % 180 ? y : x) * scale) % (image.naturalWidth * k), -t / 2]));
            ctx.fillStyle = masonry; ctx.fillRect(-scale * 0.55, -t / 2, scale * 1.1, t);
          } else { ctx.fillStyle = "#171717"; ctx.fillRect(-scale * 0.55, -t / 2, scale * 1.1, t); }
          ctx.restore();
          continue;
        }
        ctx.save(); ctx.translate(X(x + 0.5 + dx * 0.36), Y(y + 0.5 + dy * 0.36)); ctx.rotate(angle * Math.PI / 180);
        ctx.fillStyle = "#a49678"; ctx.fillRect(-scale * 0.52, -scale * 0.15, scale * 1.04, scale * 0.3);
        if (image) ctx.drawImage(image, -scale * 0.52, -scale * 0.15, scale * 1.04, scale * 0.3);
        ctx.strokeStyle = "#5b5141"; ctx.lineWidth = Math.max(1, scale * 0.035); ctx.strokeRect(-scale * 0.52, -scale * 0.15, scale * 1.04, scale * 0.3);
        ctx.restore();
      }
    }
  };

  // Штриховка расписанных клеток (пакет B): только видимые, только крупно.
  // §23: layer opacity уже применена внешним save/alpha — здесь УМНОЖЕНИЕ.
  const drawTerrainMotifs = (entries: ReadonlyMap<string, string>, defaultCode: string) => {
    if (scale < 16) return;
    ctx.save();
    ctx.lineWidth = Math.max(1, scale * 0.06);
    ctx.lineCap = "round";
    ctx.globalAlpha *= 0.32;
    for (const [key, t] of entries) {
      if (t === defaultCode) continue;
      const [x, y] = key.split(",").map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) continue;
      if (!inView(x, y)) continue;
      const { cx, cy } = cellCenter(grid, x, y);
      const ink = PATTERN_ON_DARK[t] ? chrome.paper : chrome.ink;
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      drawTerrainMotif(ctx, t, X(cx), Y(cy), scale);
    }
    ctx.restore();
  };

  // Реки — тем же приёмом, что дороги (линия по центрам), но шире, водой и ПОД
  // дорогами, чтобы мост читался. Бумажная подложка держит читаемость на воде.
  const RIVER_FILL = MAP_RIVER_FILL;
  // Общий трассировщик линейных оверлеев (дороги, реки): путь строится один раз,
  // красится вызывающим (реке нужны два прохода: бумажная подложка + вода).
  const traceOverlayLine = (set: ReadonlySet<string>) => {
    for (const key of set) {
      const [x, y] = key.split(",").map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) continue;
      if (!inView(x, y)) continue;
      const a = cellCenter(grid, x, y);
      // Соседи только «вперёд», чтобы каждый отрезок рисовался один раз.
      const fwd =
        grid === "square"
          ? [
              { x: x + 1, y },
              { x, y: y + 1 },
            ]
          : (y & 1) === 1
            ? [
                { x: x + 1, y },
                { x, y: y + 1 },
                { x: x + 1, y: y + 1 },
              ]
            : [
                { x: x + 1, y },
                { x: x - 1, y: y + 1 },
                { x, y: y + 1 },
              ];
      let alone = true;
      for (const n of fwd) {
        if (!set.has(`${n.x},${n.y}`)) continue;
        alone = false;
        const b = cellCenter(grid, n.x, n.y);
        ctx.moveTo(X(a.cx), Y(a.cy));
        ctx.lineTo(X(b.cx), Y(b.cy));
      }
      if (alone) {
        // Одиночная клетка — точка, а не пустота
        ctx.moveTo(X(a.cx), Y(a.cy));
        ctx.lineTo(X(a.cx + 0.01), Y(a.cy + 0.01));
      }
    }
  };
  const strokeRivers = (set: ReadonlySet<string>) => {
    if (set.size === 0) return;
    ctx.lineCap = "round";
    ctx.beginPath();
    traceOverlayLine(set);
    ctx.strokeStyle = chrome.paper;
    ctx.lineWidth = Math.max(2, scale * 0.34);
    ctx.stroke();
    ctx.beginPath();
    traceOverlayLine(set);
    ctx.strokeStyle = RIVER_FILL;
    ctx.lineWidth = Math.max(1.5, scale * 0.22);
    ctx.stroke();
  };

  // Дороги — линией по центрам соседних дорожных клеток.
  const strokeRoads = (set: ReadonlySet<string>) => {
    if (set.size === 0) return;
    ctx.strokeStyle = chrome.ink;
    ctx.lineWidth = Math.max(1.5, scale * 0.22);
    ctx.lineCap = "round";
    ctx.beginPath();
    traceOverlayLine(set);
    ctx.stroke();
  };

  // Настилы переправ ждут, пока не нарисуется самый верхний слой с рекой: мост лежит над водой,
  // даже если слой рек у Мастера выше слоя дорог.
  const decks: (() => void)[] = [];
  // Перекрёсток: дороги, идущие в слое подряд, сначала ложатся целиком, потом ещё раз одной серединой.
  // Рваный край одной дороги не остаётся лежать поперёк другой — они сливаются в одно пятно.
  const cores: (() => void)[] = [];
  const mergeRoads = () => { for (const draw of cores) draw(); cores.length = 0; };
  const lastRivers = model.layers.findLastIndex(layer => layer.visible && layer.kind === "path" && layer.paths.some(path => path.kind === "river"));
  /** Форма реки атласа: точки с толщиной в клетках и признаком «на суше». Река от истока растёт из нуля; последние
   * полторы клетки перед водой раскрывается воронкой; под живую воду уходит ещё на клетку — рваный берег рисуется не
   * точно по накрашенному, и без запаса между рекой и морем осталась бы полоска суши. */
  const riverShapes = new Map<RenderPath, { x: number; y: number; size: number; dry: boolean }[]>();
  const atlasRiver = (path: RenderPath) => {
    let shape = riverShapes.get(path);
    if (shape) return shape;
    const nodes = path.closed ? [...path.nodes!, path.nodes![0]] : path.nodes!;
    const samples = flattenSplineWithWidths(nodes, path.width ?? 0.22, Math.min(0.1, 2 / scale)), wet = paintedWaterAt(model), along = [0];
    for (let i = 1; i < samples.length; i++) along.push(along[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
    const total = along.at(-1) || 1, wetAt = samples.map((point) => wet(point.x, point.y) > 0);
    const mouths = samples.flatMap((_, i) => i && wetAt[i] !== wetAt[i - 1] ? [(along[i] + along[i - 1]) / 2] : []);
    const toMouth = (i: number) => Math.min(Infinity, ...mouths.map((at) => Math.abs(along[i] - at)));
    const width = Math.max(path.width ?? 0.22, 2 / scale), under = o.water ? 1 : 0;
    shape = samples.map((point, i) => ({ x: point.x, y: point.y, dry: !wetAt[i] || toMouth(i) < under,
      size: Math.pow(path.flow === "back" ? 1 - along[i] / total : along[i] / total, 0.7) * (1 + 1.6 * Math.max(0, 1 - toMouth(i) / 1.5) ** 2) * width }));
    riverShapes.set(path, shape);
    return shape;
  };
  const atlasRivers = model.layers.flatMap((layer) => layer.visible && layer.kind === "path" ? layer.paths.filter((path) => path.atlas === "river" && path.nodes && path.nodes.length > 1) : []);
  /** Вода под точкой дороги: накрашенная или река атласа. */
  const overWater = (x: number, y: number) => paintedWaterAt(model)(x, y) > 0 || atlasRivers.some((river) => {
    const shape = atlasRiver(river);
    for (let i = 1; i < shape.length; i++) {
      const a = shape[i - 1], b = shape[i];
      if (!a.dry || !b.dry) continue;
      const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(x - a.x - dx * t, y - a.y - dy * t) <= (a.size + (b.size - a.size) * t) / 2) return true;
    }
    return false;
  });
  /** Мост атласа — самостоятельный знак: светлый настил шире дороги с досками поперёк и бортами тушью, у берегов — усы
   * наружу, как на топокарте, и тень на воду. */
  const atlasBridges = (samples: readonly { x: number; y: number }[], half: number) => {
    const wet = samples.map((point) => overWater(point.x, point.y)), deck = Math.max(5, half * 1.7), line = Math.max(1.5, deck * 0.28);
    ctx.save(); ctx.setLineDash([]); ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let i = 0; i < samples.length; i++) {
      if (!wet[i] || (i && wet[i - 1])) continue;
      let j = i; while (j + 1 < samples.length && wet[j + 1]) j++;
      // Пролёт — от последней точки на суше до первой на суше за водой, и ещё немного на берег: на узкой реке мост иначе
      // короче собственных усов.
      const run = samples.slice(Math.max(0, i - 1), Math.min(samples.length, j + 2)).map((point) => ({ x: X(point.x), y: Y(point.y) }));
      i = j;
      if (run.length < 2) continue;
      const reach = Math.max(4, deck * 0.7);
      for (const [end, next] of [[0, 1], [run.length - 1, run.length - 2]]) {
        const a = run[end], b = run[next], length = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        run[end] = { x: a.x + (a.x - b.x) / length * reach, y: a.y + (a.y - b.y) / length * reach };
      }
      const tangent = (k: number) => { const a = run[Math.max(0, k - 1)], b = run[Math.min(run.length - 1, k + 1)], length = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }; };
      const side = (s: number) => run.map((point, k) => { const t = tangent(k); return { x: point.x - t.y * deck * s, y: point.y + t.x * deck * s }; });
      const left = side(-1), right = side(1), outline = () => { ctx.beginPath(); [...left, ...right.reverse()].forEach((point, k) => k ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); right.reverse(); ctx.closePath(); };
      // Тень на воду, настил закрывает дорогу, поперёк — доски, по бортам — тушь.
      ctx.save(); ctx.translate(line, line); outline(); ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill(); ctx.restore();
      outline(); ctx.fillStyle = chrome.paper; ctx.fill();
      ctx.save(); outline(); ctx.clip(); ctx.strokeStyle = chrome.ink; ctx.globalAlpha *= 0.45; ctx.lineWidth = Math.max(1, line * 0.5); ctx.beginPath();
      let walked = 0;
      for (let k = 1; k < run.length; k++) {
        const a = run[k - 1], b = run[k], length = Math.hypot(b.x - a.x, b.y - a.y), t = tangent(k);
        for (let at = Math.ceil(walked / (deck * 0.9)) * deck * 0.9 - walked; at < length; at += deck * 0.9) {
          const x = a.x + (b.x - a.x) * at / (length || 1), y = a.y + (b.y - a.y) * at / (length || 1);
          ctx.moveTo(x - t.y * deck, y + t.x * deck); ctx.lineTo(x + t.y * deck, y - t.x * deck);
        }
        walked += length;
      }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = chrome.ink; ctx.lineWidth = line;
      for (const [rail, s] of [[left, -1], [right, 1]] as const) {
        ctx.beginPath(); rail.forEach((point, k) => k ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        // Усы: с концов борта наружу и назад, под 45°.
        for (const [k, back] of [[0, 1], [rail.length - 1, -1]] as const) {
          const t = tangent(k), ear = deck * 0.9;
          ctx.moveTo(rail[k].x, rail[k].y); ctx.lineTo(rail[k].x + (-t.y * s - t.x * back) * ear, rail[k].y + (t.x * s - t.y * back) * ear);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  /** Линия атласа (М6, М16): толщина в клетках, но не тоньше пары точек экрана. Река лежит под живой водой. Тракт — двойная
   * линия: светлая середина ложится после туши всех дорог подряд, и дорога выходит из тракта, а не перечёркивает его.
   * Дорога над водой получает знак моста; морской путь — нет. */
  const strokeAtlas = (path: RenderPath, nodes: readonly SplineNode[]) => {
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (path.atlas === "river") {
      const shape = atlasRiver(path);
      for (const [color, extra] of [[chrome.ink, 2], [RIVER_FILL, 0]] as const) {
        ctx.strokeStyle = color;
        for (let i = 1; i < shape.length; i++) {
          if (!shape[i - 1].dry || !shape[i].dry) continue;
          const size = (shape[i - 1].size + shape[i].size) / 2 * scale;
          ctx.lineWidth = size + Math.min(extra, size);
          ctx.beginPath(); ctx.moveTo(X(shape[i - 1].x), Y(shape[i - 1].y)); ctx.lineTo(X(shape[i].x), Y(shape[i].y)); ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }
    const samples = flattenSplineWithWidths(nodes, path.width ?? 0.22, Math.min(0.1, 2 / scale));
    if (samples.length < 2) { ctx.restore(); return; }
    const width = Math.max(2, (path.width ?? 0.22) * scale);
    ctx.beginPath(); samples.forEach((point, i) => i ? ctx.lineTo(X(point.x), Y(point.y)) : ctx.moveTo(X(point.x), Y(point.y)));
    ctx.strokeStyle = chrome.ink;
    // Тракт — не шире обычной дороги (её ширина по умолчанию 0,2 против 0,3 у тракта): три равные полосы —
    // обводка тушью, светлая середина, обводка. Не тоньше трёх точек экрана, чтобы середина не пропадала.
    const casing = Math.max(3, width * 0.6);
    if (path.atlas === "highway") {
      ctx.lineWidth = casing; ctx.stroke();
      cores.push(() => {
        ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = chrome.paper; ctx.lineWidth = casing / 3;
        ctx.beginPath(); samples.forEach((point, i) => i ? ctx.lineTo(X(point.x), Y(point.y)) : ctx.moveTo(X(point.x), Y(point.y))); ctx.stroke(); ctx.restore();
      });
    } else if (path.atlas === "trail") { ctx.setLineDash([width * 2.4, width * 1.6]); ctx.lineWidth = width * 0.8; ctx.stroke(); }
    else if (path.atlas === "sea") { ctx.setLineDash([0.1, width * 2.2]); ctx.lineWidth = width * 1.1; ctx.stroke(); }
    else { ctx.lineWidth = width; ctx.stroke(); }
    ctx.restore();
    // Мост — после туши и середины всех дорог подряд: настил закрывает дорогу, а не она его.
    if (path.atlas !== "sea") cores.push(() => atlasBridges(samples, (path.atlas === "highway" ? casing : path.atlas === "trail" ? width * 0.8 : width) / 2));
  };
  const strokeFreePath = (path: RenderPath) => {
    if (!path.nodes || path.nodes.length < 2) return;
    const nodes = path.closed ? [...path.nodes, path.nodes[0]] : path.nodes;
    if (path.atlas) { strokeAtlas(path, nodes); return; }
    const baseWidth = path.width ?? 0.22;
    // Река с материалом: линия, залитая поверхностью воды (узор привязан к карте, как у кисти поверхности).
    const water = path.kind === "river" && path.style ? surfaceImage(`village-${path.style.slice(path.style.indexOf(":") + 1)}`, false, pack) : null;
    const riverFill = (water && ctx.canvas ? surfacePattern(ctx, water, scale, ox, oy, pack) : null) ?? RIVER_FILL;
    const bank = water ? { color: chrome.ink, k: 1.1 } : { color: chrome.paper, k: 1.55 };
    // Река своего набора — полоса, как дорога; встроенная — заливка поверхностью воды.
    const strip = path.style && (path.kind !== "river" || ownPackOf(path.style)) ? stripImage(path.style) : null;
    if (strip) {
      // Шаг крупнее, чем у линии тушью: каждый отрезок — своя заливка узором с обрезкой.
      const road = path.kind === "road";
      const { samples, minX, minY, maxX, maxY } = stripSamples(path.nodes, path.closed === true, baseWidth, 10 / scale, road);
      if (X(maxX) < 0 || Y(maxY) < 0 || X(minX) > canvasW || Y(minY) > canvasH) return;
      const view = { width: canvasW, height: canvasH }, crossings = roadCrossings(model, path);
      const lay = (points: typeof samples) => {
        drawWallPolyline(ctx, points, baseWidth, false, scale, ox, oy, false, view, strip);
        if (road) cores.push(() => drawWallPolyline(ctx, points, baseWidth, false, scale, ox, oy, false, view, strip, ROAD_CORE));
      };
      if (crossings.some(crossing => crossing.kind !== "none")) {
        // Над водой дорогу сменяет настил: мост или брод. Картинка настила — полоса набора; пока она грузится — заглушка.
        let cut = roadCuts.get(samples);
        if (cut?.key !== cutKey(crossings)) roadCuts.set(samples, cut = cutRoad(samples, crossings));
        for (const piece of cut.road) lay(piece);
        for (const deck of cut.decks) decks.push(() => {
          const art = deck.kind === "none" ? null : stripImage(deck.art ?? ownDeck(path.style!, deck.kind) ?? villageId(deckKey(deck.kind, path.style!)));
          if (art) drawWallPolyline(ctx, deck.samples, baseWidth, false, scale, ox, oy, false, view, art);
          else drawCrossingDraft(ctx, deck.kind, deck.samples, scale, ox, oy, chrome.ink);
        });
      }
      else lay(samples);
      // Ограда: столб на каждой опорной точке — закрывает обрез полосы на концах и стык на изломе.
      const postId = path.kind === "wall" ? fencePostId(path.style!) ?? ownLinePost(path.style!) : null, post = postId ? stripImage(postId) : null;
      if (post) for (const node of path.nodes) {
        const side = (node.width ?? baseWidth) * 2 * scale;
        ctx.drawImage(post, X(node.position.x) - side / 2, Y(node.position.y) - side / 2, side, side);
      }
      return;
    }
    const firstWidth = nodes[0].width ?? baseWidth;
    const varyingWidth = nodes.some((node) => (node.width ?? baseWidth) !== firstWidth);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (varyingWidth) {
      const samples = flattenSplineWithWidths(nodes, baseWidth, 3 / scale);
      const strokeSamples = (color: string | CanvasPattern, multiplier: number) => {
        ctx.strokeStyle = color;
        for (let index = 1; index < samples.length; index++) {
          const from = samples[index - 1], to = samples[index];
          ctx.lineWidth = Math.max(1.5, (from.width + to.width) / 2 * scale) * multiplier;
          ctx.beginPath();
          ctx.moveTo(X(from.x), Y(from.y));
          ctx.lineTo(X(to.x), Y(to.y));
          ctx.stroke();
        }
      };
      if (path.kind === "river") strokeSamples(bank.color, bank.k);
      strokeSamples(path.kind === "river" ? riverFill : chrome.ink, 1);
      ctx.restore();
      return;
    }
    ctx.beginPath();
    nodes.forEach((node, index) => {
      if (index === 0) {
        ctx.moveTo(X(node.position.x), Y(node.position.y));
      } else {
        const previous = nodes[index - 1];
        if (previous.out && node.in) {
          const c1 = previous.out;
          const c2 = node.in;
          ctx.bezierCurveTo(X(c1.x), Y(c1.y), X(c2.x), Y(c2.y),
            X(node.position.x), Y(node.position.y));
        } else {
          ctx.lineTo(X(node.position.x), Y(node.position.y));
        }
      }
    });
    const inner = Math.max(1.5, firstWidth * scale);
    if (path.kind === "river") {
      ctx.strokeStyle = bank.color;
      ctx.lineWidth = inner * bank.k;
      ctx.stroke();
      ctx.strokeStyle = riverFill;
    } else {
      ctx.strokeStyle = chrome.ink;
    }
    ctx.lineWidth = inner;
    ctx.stroke();
    ctx.restore();
  };

  // Gameplay-сущности рисуются в порядке items[] слоя (§16), без сортировки
  // по kind. Объекты при scale < 10 не рисуются, глифы/текст — при < 14.
  // Комнаты: тинт типа + номер + имя. idx — номер среди комнат слоя.
  const drawRoomTint = (r: RenderRoom, idx: number) => {
    const rc = r.rect;
    // Квартал: заливка, контур и имя, которое видно на любом приближении — по нему читают город целиком.
    // Раньше проверок комнаты: контур квартала не обязан идти по клеткам.
    if (r.fill) {
      const w = rc.w * scale, h = rc.h * scale, corners = r.points ?? [{ x: rc.x, y: rc.y }, { x: rc.x + rc.w, y: rc.y }, { x: rc.x + rc.w, y: rc.y + rc.h }, { x: rc.x, y: rc.y + rc.h }];
      // Имя — в центре тяжести контура: у вытянутого или угловатого квартала середина габаритов может лежать снаружи.
      let area = 0, cx = 0, cy = 0;
      corners.forEach((a, i) => { const b = corners[(i + 1) % corners.length], cross = a.x * b.y - b.x * a.y; area += cross; cx += (a.x + b.x) * cross; cy += (a.y + b.y) * cross; });
      const at = Math.abs(area) > 1e-9 ? { x: cx / (3 * area), y: cy / (3 * area) } : { x: rc.x + rc.w / 2, y: rc.y + rc.h / 2 };
      ctx.save();
      ctx.beginPath(); corners.forEach((point, i) => i ? ctx.lineTo(X(point.x), Y(point.y)) : ctx.moveTo(X(point.x), Y(point.y))); ctx.closePath();
      ctx.fillStyle = r.fill; ctx.globalAlpha *= 0.28; ctx.fill();
      ctx.globalAlpha /= 0.28; ctx.strokeStyle = r.fill; ctx.lineWidth = Math.max(1.5, scale * 0.08); ctx.lineJoin = "round";
      ctx.setLineDash([scale * 0.4, scale * 0.25]); ctx.stroke();
      const size = Math.min(h * 0.4, w / Math.max(4, r.name.length) * 1.5, 48);
      if (r.name && size >= 7) {
        ctx.font = `700 ${size}px ${fonts.label}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.setLineDash([]); ctx.lineWidth = size * 0.22; ctx.strokeStyle = chrome.paper;
        ctx.strokeText(r.name, X(at.x), Y(at.y), w * 0.94);
        ctx.fillStyle = chrome.ink; ctx.fillText(r.name, X(at.x), Y(at.y), w * 0.94);
      }
      ctx.restore();
      return;
    }
    if (!Number.isInteger(rc.x) || !Number.isInteger(rc.y) || !Number.isInteger(rc.w) || !Number.isInteger(rc.h)) return;
    if (rc.w < 1 || rc.h < 1 || rc.x < 0 || rc.y < 0 || rc.x + rc.w > width || rc.y + rc.h > height) return;
      const tint = MAP_ROOM_TINT[r.type];
      if (scale >= 14) {
        const cxp = X(rc.x) + (rc.w * scale) / 2;
        const cyp = o.cartography ? Y(rc.y + 0.7) : Y(rc.y) + (rc.h * scale) / 2;
        ctx.save();
        ctx.fillStyle = chrome.muted;
        ctx.globalAlpha *= 0.8;
        ctx.font = `${Math.max(11, Math.min(14, Math.round(scale * 0.3)))}px ${fonts.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // M4: безымянная комната — не голый номер, а «Казарма 3» / «Комната 3».
        ctx.fillText(r.name || (r.type === "empty" ? `Комната ${idx + 1}` : `${MAP_ROOM_LABELS[r.type] ?? r.type} ${idx + 1}`), cxp, cyp, Math.max(20, (rc.w - 0.6) * scale));
        ctx.restore();
        if (r.name && !o.cartography) {
          ctx.save();
          ctx.fillStyle = chrome.muted;
          ctx.font = `500 ${Math.max(11, Math.min(14, Math.round(scale * 0.3)))}px ${fonts.label}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(r.name, cxp, Y(rc.y) + 2, rc.w * scale);
          ctx.restore();
        }
      }
    };

    // Обводка комнат со стороны стен (хотелка 2): сегмент периметра рисуется,
    // только если за ним стена (террейн wall) или край карты; где проём — нет
    // линии; на рёбрах с видимой дверью — пропуск (там уже дверь).
    // wallAt — композитный террейн стека, doorPoints — все видимые слои (3A).
    const wallAt = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= height) return true;
      return terrainAt(x, y) === "wall";
    };
    const inRoom = (rc: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean =>
      x >= rc.x && x < rc.x + rc.w && y >= rc.y && y < rc.y + rc.h;
    const DIRS_SQ: { dx: number; dy: number; edge: "n" | "s" | "e" | "w" }[] = [
      { dx: 0, dy: -1, edge: "n" },
      { dx: 0, dy: 1, edge: "s" },
      { dx: -1, dy: 0, edge: "w" },
      { dx: 1, dy: 0, edge: "e" },
    ];
    const seg2 = (ax: number, ay: number, bx: number, by: number) => {
      ctx.moveTo(X(ax), Y(ay));
      ctx.lineTo(X(bx), Y(by));
    };
    const strokeRoomOutline = (r: RenderRoom) => {
      const rc = r.rect;
      if (!Number.isInteger(rc.x) || !Number.isInteger(rc.y) || !Number.isInteger(rc.w) || !Number.isInteger(rc.h)) return;
      if (rc.w < 1 || rc.h < 1 || rc.x < 0 || rc.y < 0 || rc.x + rc.w > width || rc.y + rc.h > height) return;
      // Грубый отсев заэкранных комнат (гексам запас в клетку на выступы).
      if (X(rc.x + rc.w) < -scale || X(rc.x) > canvasW + scale || Y(rc.y + rc.h) < -scale || Y(rc.y) > canvasH + scale) return;
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = Math.max(1.5, scale * 0.1);
      ctx.lineCap = "butt";
      ctx.beginPath();
      for (let y = rc.y; y < rc.y + rc.h; y++) {
        for (let x = rc.x; x < rc.x + rc.w; x++) {
          if (grid === "square") {
            for (const d of DIRS_SQ) {
              const nx = x + d.dx;
              const ny = y + d.dy;
              if (inRoom(rc, nx, ny)) continue;
              if (!wallAt(nx, ny)) continue;
              // Середина кандидатного сегмента: совпала с дверью — пропуск.
              const mx = d.edge === "w" ? x : d.edge === "e" ? x + 1 : x + 0.5;
              const my = d.edge === "n" ? y : d.edge === "s" ? y + 1 : y + 0.5;
              if (doorPoints.has(`${mx},${my}`)) continue;
              if (d.edge === "n") seg2(x, y, x + 1, y);
              else if (d.edge === "s") seg2(x, y + 1, x + 1, y + 1);
              else if (d.edge === "w") seg2(x, y, x, y + 1);
              else seg2(x + 1, y, x + 1, y + 1);
            }
          } else {
            const pts = cellCorners(grid, x, y);
            for (const n of neighbors(grid, x, y)) {
              if (inRoom(rc, n.x, n.y)) continue;
              if (!wallAt(n.x, n.y)) continue;
              const q = cellCorners(grid, n.x, n.y);
              const shared = pts.filter((p) =>
                q.some((s) => Math.abs(s.px - p.px) < 1e-6 && Math.abs(s.py - p.py) < 1e-6)
              );
              if (shared.length === 2) seg2(shared[0].px, shared[0].py, shared[1].px, shared[1].py);
            }
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    // Двери: тёмная подложка поперёк ребра + цвет вида + глиф.
    // Геометрия — мировая (position = середина ребра, horizontal = ось n/s);
    // формулы сведены к прежним поклеточным один в один (px±0.5 = x/x+1).
    // На гексах дверей нет (создание заблокировано), API-инъекцию молча
    // не рисуем, чтобы не врать геометрией.
    const drawDoor = (d: RenderDoor) => {
      if (grid !== "square") return;
      const px = d.position.x;
      const py = d.position.y;
      // Тот же отсев, что поклеточный inView (для legacy-данных эквивалентен:
      // px = x+0.5 в [vx0, vx1+1] ⟺ целое x в [vx0, vx1]).
      if (px < vx0 || px > vx1 + 1 || py < vy0 || py > vy1 + 1) return;
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      const { kind, hidden } = doorForView(d, playerView);
      if (hidden) return;
      const horizontal = d.horizontal;
      // Подложка во всю клетку поперёк ребра.
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = Math.max(2, scale * 0.2);
      ctx.lineCap = "butt";
      ctx.beginPath();
      const half = (d.span ?? 1) / 2;
      if (horizontal) {
        ctx.moveTo(X(px - half), Y(py));
        ctx.lineTo(X(px + half), Y(py));
      } else {
        ctx.moveTo(X(px), Y(py - half));
        ctx.lineTo(X(px), Y(py + half));
      }
      ctx.stroke();
      // Плашка вида по центру ребра.
      const pw = horizontal ? scale * 0.72 : Math.max(3, scale * 0.34);
      const ph = horizontal ? Math.max(3, scale * 0.34) : scale * 0.72;
      const qx = X(px) - pw / 2;
      const qy = Y(py) - ph / 2;
      // Проём из набора рисуется при любом оформлении; пока картинка грузится — обычный знак двери.
      const ownArt = d.style ? stripImage(d.style) : null;
      const doorArt = ownArt ?? (o.cartography ? doorImage(d.secret ? "secret" : kind, pack) : null);
      if (doorArt) {
        ctx.save(); ctx.translate(X(px), Y(py)); if (!horizontal) ctx.rotate(Math.PI / 2);
        if (ownArt) { const along = (d.span ?? 1) * scale, across = along * ownArt.naturalHeight / ownArt.naturalWidth; ctx.drawImage(ownArt, -along / 2, -across / 2, along, across); }
        else if (pack === "crypt") ctx.drawImage(doorArt, -scale * 0.5, -scale * 0.5, scale, scale); // проём нарисован с обрубками стены
        else ctx.drawImage(doorArt, -scale * 0.5, -scale * 0.14, scale, scale * 0.28);
        ctx.restore();
      }
      ctx.fillStyle = MAP_DOOR_FILL[kind];
      if (!doorArt) ctx.fillRect(qx, qy, pw, ph);
      ctx.lineWidth = 1;
      ctx.strokeStyle = chrome.ink;
      if (!playerView && (d.kind === "secret" || d.secret)) ctx.setLineDash([3, 2]);
      if (!doorArt) ctx.strokeRect(qx + 0.5, qy + 0.5, pw, ph);
      ctx.setLineDash([]);
      if (scale >= 14 && !doorArt) {
        ctx.fillStyle = chrome.ink;
        ctx.font = `700 ${Math.min(11, Math.round(scale * 0.32))}px ${fonts.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(MAP_DOOR_GLYPHS[kind], qx + pw / 2, qy + ph / 2 + 0.5);
      }
      // Выбранная дверь — чернильной обводкой (координатная отметка, §1.8).
      if (selectedId !== null && selectedId === d.id) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = chrome.ink;
        ctx.strokeRect(qx - 2.5, qy - 2.5, pw + 5, ph + 5);
      }
      ctx.restore();
    };

    // Ловушки: плашка + символ. Игрок их не видит.
    const drawTrap = (t: RenderTrap) => {
      if (playerView) return;
        const tx = t.position.x;
        const ty = t.position.y;
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
        if (!inViewWorld(tx, ty)) return;
        const ss = scale * 0.6;
        const sx = X(tx) - ss / 2;
        const sy = Y(ty) - ss / 2;
        ctx.save();
        ctx.fillStyle = chrome.paper;
        ctx.fillRect(sx, sy, ss, ss);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = chrome.ink;
        ctx.strokeRect(sx, sy, ss, ss);
        if (scale >= 14) {
          ctx.fillStyle = chrome.ink;
          ctx.font = `700 ${Math.min(11, Math.round(scale * 0.34))}px ${fonts.mono}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(MAP_TRAP_GLYPHS[t.kind], sx + ss / 2, sy + ss / 2 + 0.5);
        }
        if (selectedId !== null && selectedId === t.id) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = chrome.ink;
          ctx.strokeRect(sx - 2.5, sy - 2.5, ss + 5, ss + 5);
        }
        ctx.restore();
    };

    // Маркеры (сундуки, алтари): видны всем, включая игрока. Сундук — плашка
    // с крышкой, алтарь — круг с точкой. Выбранный — чернильной обводкой.
    const drawMarker = (mk: RenderMarker) => {
      const mx0 = mk.position.x;
      const my0 = mk.position.y;
      if (!Number.isFinite(mx0) || !Number.isFinite(my0)) return;
      if (!inViewWorld(mx0, my0)) return;
      const ms = scale * 0.6;
      const mx = X(mx0) - ms / 2;
      const my = Y(my0) - ms / 2;
      const cx = X(mx0);
      const cy = Y(my0);
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = chrome.ink;
      if (mk.kind === "chest") {
        ctx.fillStyle = chrome.paper;
        ctx.fillRect(mx, my, ms, ms);
        ctx.strokeRect(mx, my, ms, ms);
        ctx.beginPath();
        ctx.moveTo(mx, my + ms * 0.35);
        ctx.lineTo(mx + ms, my + ms * 0.35);
        ctx.stroke();
      } else if (mk.kind === "altar") {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2, ms / 2), 0, Math.PI * 2);
        ctx.fillStyle = chrome.paper;
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, ms * 0.16), 0, Math.PI * 2);
        ctx.fillStyle = chrome.ink;
        ctx.fill();
      } else if (mk.kind === "city") {
        // Ромб с точкой.
        ctx.beginPath();
        ctx.moveTo(cx, my);
        ctx.lineTo(mx + ms, cy);
        ctx.lineTo(cx, my + ms);
        ctx.lineTo(mx, cy);
        ctx.closePath();
        ctx.fillStyle = chrome.paper;
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, ms * 0.12), 0, Math.PI * 2);
        ctx.fillStyle = chrome.ink;
        ctx.fill();
      } else if (mk.kind === "village") {
        // Домик: квадрат + крыша.
        ctx.beginPath();
        ctx.moveTo(mx, my + ms);
        ctx.lineTo(mx, my + ms * 0.45);
        ctx.lineTo(cx, my);
        ctx.lineTo(mx + ms, my + ms * 0.45);
        ctx.lineTo(mx + ms, my + ms);
        ctx.closePath();
        ctx.fillStyle = chrome.paper;
        ctx.fill();
        ctx.stroke();
      } else if (mk.kind === "camp") {
        // Палатка-треугольник.
        ctx.beginPath();
        ctx.moveTo(mx, my + ms);
        ctx.lineTo(cx, my);
        ctx.lineTo(mx + ms, my + ms);
        ctx.closePath();
        ctx.fillStyle = chrome.paper;
        ctx.fill();
        ctx.stroke();
      } else if (mk.kind === "metro") {
        // Двойной ромб — большой город.
        const diamond = (r: number) => {
          ctx.beginPath();
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx + r, cy);
          ctx.lineTo(cx, cy + r);
          ctx.lineTo(cx - r, cy);
          ctx.closePath();
        };
        diamond(ms / 2);
        ctx.fillStyle = chrome.paper;
        ctx.fill();
        ctx.stroke();
        diamond(Math.max(1.5, ms * 0.22));
        ctx.stroke();
      } else if (mk.kind === "battle") {
        // Крест-накрест.
        ctx.lineWidth = Math.max(2, ms * 0.18);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + ms, my + ms);
        ctx.moveTo(mx + ms, my);
        ctx.lineTo(mx, my + ms);
        ctx.stroke();
      } else {
        // Обелиск: высокий брусок (и фолбэк неизвестного вида — не пустота).
        ctx.fillStyle = chrome.paper;
        ctx.fillRect(cx - ms * 0.14, my + ms * 0.05, ms * 0.28, ms * 0.9);
        ctx.strokeRect(cx - ms * 0.14, my + ms * 0.05, ms * 0.28, ms * 0.9);
      }
      if (selectedId !== null && selectedId === mk.id) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = chrome.ink;
        ctx.strokeRect(mx - 2.5, my - 2.5, ms + 5, ms + 5);
      }
      ctx.restore();
    };

    // Старт/финиш: видны всем.
    const drawStartFinish = (key: "start" | "finish", p: RenderStartFinish) => {
      if (!Number.isFinite(p.position.x) || !Number.isFinite(p.position.y)) return;
      if (!inViewWorld(p.position.x, p.position.y)) return;
      const cxp = X(p.position.x);
      const cyp = Y(p.position.y);
      ctx.save();
      if (key === "start") {
        ctx.beginPath();
        ctx.arc(cxp, cyp, Math.max(3, scale * 0.38), 0, Math.PI * 2);
        ctx.fillStyle = "#0a4a2a";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#3dd68c";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cxp, cyp, Math.max(1.5, scale * 0.1), 0, Math.PI * 2);
        ctx.fillStyle = "#3dd68c";
        ctx.fill();
      } else {
        const s = scale - 2;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(cxp - s / 2, cyp - s / 2, s, s);
        ctx.fillStyle = chrome.ink;
        ctx.fillRect(cxp - s / 2, cyp - s / 2, s / 2, s / 2);
        ctx.fillRect(cxp, cyp, s / 2, s / 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = chrome.ink;
        ctx.strokeRect(cxp - s / 2, cyp - s / 2, s, s);
      }
      if (scale >= 14) {
        ctx.font = `500 8px ${fonts.label}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = key === "start" ? "#3dd68c" : chrome.ink;
        ctx.fillText(key === "start" ? "СТАРТ" : "ФИНИШ", cxp, cyp + scale * 0.4);
      }
      if (selectedId !== null && selectedId === p.id) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = chrome.ink;
        ctx.strokeRect(cxp - scale / 2 - 2.5, cyp - scale / 2 - 2.5, scale + 5, scale + 5);
      }
      ctx.restore();
    };

  // Подписи рисуются в позиции своего label-слоя в стеке (3A §17), а не
  // специальным "всегда сверху" проходом. Только на крупном зуме, иначе каша.
  const drawLabel = (l: RenderLabel) => {
    if (!Number.isFinite(l.position.x) || !Number.isFinite(l.position.y)) return;
    const px = X(l.position.x);
    const py = Y(l.position.y);
    // Своя высота букв задана в клетках и растёт вместе с картой; без неё подпись держит размер на экране
    // и на мелком масштабе прячется, иначе каша.
    const style = l.style, size = style?.size, fontPx = size ? size * scale : Math.max(11, Math.min(16, Math.round(scale * 0.36)));
    if (size ? fontPx < 5 : scale < 12) return;
    // Текст шире клетки: подпись у края плитки рисуется и на соседней, иначе её режет граница.
    const box = labelBox(l);
    if (X(box.x + box.w) < -24 || X(box.x) > canvasW + 24 || Y(box.y + box.h) < -24 || Y(box.y) > canvasH + 24) return;
    ctx.save();
    ctx.font = `${style?.italic ? "italic " : ""}${style?.bold ? 700 : 500} ${fontPx}px ${labelFamily(style?.font) ?? fonts.label}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const color = style?.color ?? chrome.ink, limit = size ? [] : [scale * 8];
    if (style?.dot !== false) {
      // Точка-маркер в центре клетки.
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, scale * 0.09), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    // Текст с бумажной подложкой-обводкой, чтобы читался на любом террейне.
    ctx.lineWidth = Math.max(3, fontPx * 0.2);
    ctx.lineJoin = "round";
    ctx.strokeStyle = chrome.paper;
    ctx.strokeText(l.text, px, py - scale * 0.12, ...limit);
    ctx.fillStyle = color;
    ctx.fillText(l.text, px, py - scale * 0.12, ...limit);
    ctx.restore();
  };

  // Keep layer order within each pass; grid separates terrain/paths from foreground artwork.
  let hasTerrainSurface = false;
  const tokenDraws: (() => void)[] = [];
  const drawLayer = (layer: MapRenderModel["layers"][number]) => {
    if (!layer.visible) return;
    if (part === "over" && layer.kind === "terrain" || part === "ground" && layer.kind !== "terrain" && layer.kind !== "path") return;
    // Под живой водой — земля, а не картинка жидкости: шейдер сам решает, сколько дна видно (гриллинг 2026-10-15, В2).
    if (part === "ground" && layer.kind === "terrain" && layer.name === LIQUID_LAYER && layer.terrain.mask) return;
    ctx.save();
    ctx.globalAlpha *= layer.opacity;
    if (layer.kind === "terrain") {
      if (layer.terrain.mask) {
        if (!hasTerrainSurface) fillTerrainDefault(layer.terrain.defaultCode);
        fillTerrainMask(layer.terrain.mask);
      }
      else {
        fillTerrainDefault(layer.terrain.defaultCode);
        fillTerrainEntries(layer.terrain.entries, layer.terrain.defaultCode);
        if (!o.cartography) drawTerrainMotifs(layer.terrain.entries, layer.terrain.defaultCode);
        drawWallEdges(layer.terrain);
      }
      hasTerrainSurface = true;
    } else if (layer.kind === "path") {
      // paths[] order = render order (§14): реки отдельно ниже дорог НЕ
      // фиксируются — порядок задают сами слои (migrated: river-слой ниже).
      // Реки атласа — под дорогами того же слоя: в атласе дорога переходит реку поверху.
      const paths = layer.paths.some(path => path.atlas === "river") ? [...layer.paths.filter(path => path.atlas === "river"), ...layer.paths.filter(path => path.atlas !== "river")] : layer.paths;
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (part && (part === "ground") !== waterRiver(p)) continue;
        if (p.kind !== "road") mergeRoads();
        // Стена со своей полосой (ограда) рисуется как линия-полоса, а не кладкой.
        if (p.kind === "wall" && p.nodes && !p.style) {
          let end = i + 1;
          while (end < paths.length && paths[end].kind === "wall" && paths[end].nodes && !paths[end].style) end++;
          drawCachedWalls(ctx, paths.slice(i, end), scale, ox, oy, canvasW, canvasH, pixelRatio); i = end - 1;
        }
        else if (p.nodes) strokeFreePath(p);
        else if (p.kind === "river") strokeRivers(p.cells);
        else strokeRoads(p.cells);
      }
      mergeRoads();
      if (decks.length && model.layers.indexOf(layer) >= lastRivers) { for (const draw of decks) draw(); decks.length = 0; }
    } else if (layer.kind === "gameplay") {
      if (scale >= 10) {
        let roomIdx = 0;
        for (const it of layer.items) {
          if (it.kind === "room") {
            drawRoomTint(it.room, roomIdx++);
            strokeRoomOutline(it.room);
          } else if (it.kind === "door") drawDoor(it.door);
          else if (it.kind === "trap") drawTrap(it.trap);
          else if (it.kind === "marker") drawMarker(it.marker);
          else if (it.kind === "token" && (!playerView || it.token.sourceRef === null)) {
            // Only the GM receives transient source presentation data; the
            // player projection sends detached tokens with resolved labels.
            tokenDraws.push(() => {
            ctx.save(); ctx.globalAlpha *= layer.opacity;
            const token = it.token;
            const radius = token.size * scale / 2;
            const tx = X(token.position.x), ty = Y(token.position.y);
            ctx.save();
            ctx.translate(tx, ty);
            ctx.rotate(token.rotation * Math.PI / 180);
            ctx.beginPath();
            if (token.appearance.shape === "circle") ctx.arc(0, 0, radius, 0, Math.PI * 2);
            else { ctx.moveTo(0, -radius); ctx.lineTo(radius, 0); ctx.lineTo(0, radius); ctx.lineTo(-radius, 0); ctx.closePath(); }
            ctx.fillStyle = chrome.paper;
            ctx.fill();
            const portrait = token.appearance.visual.type === "entity-avatar" ? it.display?.portrait : null;
            if (portrait) {
              ctx.save(); ctx.clip();
              const crop = Math.min(portrait.naturalWidth, portrait.naturalHeight);
              ctx.drawImage(portrait, (portrait.naturalWidth - crop) / 2, (portrait.naturalHeight - crop) / 2, crop, crop, -radius, -radius, radius * 2, radius * 2);
              ctx.restore();
            }
            ctx.strokeStyle = chrome.ink;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = chrome.ink;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `${Math.max(10, radius)}px sans-serif`;
            if (!portrait) ctx.fillText(it.display?.state === "missing" ? "?" : token.sourceRef?.kind === "location" || token.appearance.visual.type === "builtin" && token.appearance.visual.key === "location" ? "⌂" : "●", 0, 0);
            if (selectedId === token.id) { ctx.strokeStyle = "#ff3e91"; ctx.lineWidth = 3; ctx.strokeRect(-radius - 3, -radius - 3, radius * 2 + 6, radius * 2 + 6); }
            ctx.restore();
            ctx.save();
            ctx.translate(tx, ty + radius);
            let tiltSeed = 2166136261;
            for (const char of token.id) tiltSeed = Math.imul(tiltSeed ^ char.charCodeAt(0), 16777619);
            ctx.rotate((((tiltSeed >>> 0) / 4294967295) * 12 - 6) * Math.PI / 180);
            // Label artwork uses a 200px token reference; camera zoom and token size scale it together.
            const labelScale = Math.max(0.75, Math.min(2, token.size)) * scale / 200;
            ctx.scale(labelScale, labelScale);
            ctx.font = `700 24px ${fonts.label}`;
            ctx.textAlign = "center";
            const name = token.label.mode === "custom" ? token.label.text : it.display?.name ?? "Загрузка источника…";
            const measured = ctx.measureText(name).width;
            const labelWidth = Math.max(96, Math.min(Number.isFinite(measured) ? measured + 48 : 200, 240));
            const tape = tokenTapeImage();
            const labelHeight = 48, left = -labelWidth / 2, top = -labelHeight / 2;
            if (tape) {
              const cap = 32, slice = 24;
              ctx.drawImage(tape, 0, 0, slice, tape.naturalHeight, left, top, cap, labelHeight);
              ctx.drawImage(tape, slice, 0, tape.naturalWidth - slice * 2, tape.naturalHeight, left + cap, top, labelWidth - cap * 2, labelHeight);
              ctx.drawImage(tape, tape.naturalWidth - slice, 0, slice, tape.naturalHeight, left + labelWidth - cap, top, cap, labelHeight);
            } else { ctx.fillStyle = "#f54291"; ctx.fillRect(left, top, labelWidth, labelHeight); }
            ctx.fillStyle = "#171219";
            ctx.textBaseline = "middle";
            ctx.fillText(name, 0, 0, labelWidth - 40);
            ctx.restore();
            ctx.restore();
            });
          }
          else if (it.kind === "start") drawStartFinish("start", it.start);
          else if (it.kind === "finish") drawStartFinish("finish", it.finish);
        }
      }
    } else if (layer.kind === "label") {
      for (const l of layer.labels) drawLabel(l);
    } else if (layer.kind === "object" || layer.kind === "scatter") {
      // Грязь «Склепа» под предметами: движок кладёт её сам, детерминированно по id (Q1 2026-10-01).
      if (pack === "crypt" && layer.kind === "object" && scale >= 10) for (const { object } of layer.items) {
        const grime = grimeFor(object.id);
        const image = grime && artworkImage(grime.key, "crypt");
        if (!grime || !image) continue;
        const size = Math.max(Math.abs(object.transform.scale.x), Math.abs(object.transform.scale.y));
        ctx.save();
        ctx.translate(X(object.transform.position.x + grime.dx * size), Y(object.transform.position.y + grime.dy * size));
        ctx.rotate(grime.angle); ctx.globalAlpha *= 0.85;
        const g = grime.size * scale;
        ctx.drawImage(image, -g / 2, -g / 2, g, g);
        ctx.restore();
      }
      for (const { object, asset } of layer.items) {
        const { position, scale: objectScale } = object.transform;
        let { rotation } = object.transform;
        // Поворотный предмет: вид по стороне, сама картинка не крутится.
        // У своих наборов вид стороны может быть не задан или ещё грузиться — тогда картинка просто поворачивается.
        const base = "image" in asset ? asset : null, side = base?.views?.[cryptSide(rotation)] ?? null;
        const view = side && (side.image || !base?.image) ? side : null;
        if (view) rotation = 0;
        const art = view ? view.image : "image" in asset ? asset.image : null;
        const margin = Math.max(Math.abs(objectScale.x), Math.abs(objectScale.y)) * scale * Math.SQRT2 / 2;
        const sx = X(position.x);
        const sy = Y(position.y);
        if (sx < -margin || sx > canvasW + margin || sy < -margin || sy > canvasH + margin) continue;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.scale(scale * objectScale.x, scale * objectScale.y);
        if ("glyph" in asset) drawCachedMapSymbol(ctx, asset);
        else if (art) {
          drawCachedMapImage(ctx, art, Math.max(Math.abs(objectScale.x), Math.abs(objectScale.y)) * scale * pixelRatio);
        }
        else {
          ctx.fillStyle = "#b9a68e";
          ctx.fillRect(-0.5, -0.5, 1, 1);
          ctx.strokeStyle = "#282922";
          ctx.lineWidth = 0.05;
          ctx.strokeRect(-0.5, -0.5, 1, 1);
        }
        ctx.restore();
        // Заглушка вещи из набора в архиве подписана: Мастер видит, какой набор вернуть.
        if ("missing" in asset && asset.missing && !playerView && scale >= 12) {
          ctx.save();
          ctx.font = `700 ${Math.max(9, Math.min(12, Math.round(scale * 0.22)))}px ${fonts.mono}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = "#282922";
          ctx.fillText(asset.missing, sx, sy, Math.max(Math.abs(objectScale.x), Math.abs(objectScale.y)) * scale - 4);
          ctx.restore();
        }
        if (selectedId === object.id && !playerView) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(rotation * Math.PI / 180);
          ctx.strokeStyle = chrome.ink;
          ctx.lineWidth = 2;
          ctx.strokeRect(-scale * objectScale.x / 2, -scale * objectScale.y / 2, scale * objectScale.x, scale * objectScale.y);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  };
  const belowGrid = (layer: MapRenderModel["layers"][number]) => layer.kind === "terrain" || layer.kind === "path";
  for (const layer of model.layers) if (!showGrid || belowGrid(layer)) drawLayer(layer);
  if (part === "ground") { ctx.restore(); return; }

  // Grid thickness and dash lengths are in screen pixels, independent of zoom.
  if (showGrid) {
    ctx.save();
    ctx.strokeStyle = o.gridColor ?? chrome.line;
    ctx.globalAlpha = Math.max(0, Math.min(1, o.gridOpacity ?? 0.35));
    ctx.lineWidth = Math.max(0.5, Math.min(4, o.gridLineWidth ?? 1));
    ctx.setLineDash(o.gridLineStyle === "dashed" ? [6, 4] : []);
    ctx.beginPath();
    if (grid === "square") {
      for (let x = vx0; x <= vx1 + 1; x++) {
        ctx.moveTo(Math.round(X(x)) + 0.5, Math.round(Y(0)) + 0.5);
        ctx.lineTo(Math.round(X(x)) + 0.5, Math.round(Y(height)) + 0.5);
      }
      for (let y = vy0; y <= vy1 + 1; y++) {
        ctx.moveTo(Math.round(X(0)) + 0.5, Math.round(Y(y)) + 0.5);
        ctx.lineTo(Math.round(X(width)) + 0.5, Math.round(Y(y)) + 0.5);
      }
    } else {
      for (let y = vy0; y <= vy1; y++)
        for (let x = vx0; x <= vx1; x++) {
          const pts = cellCorners(grid, x, y);
          ctx.moveTo(X(pts[0].px), Y(pts[0].py));
          for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].px), Y(pts[i].py));
          ctx.closePath();
        }
    }
    ctx.stroke();
    ctx.restore();
  }

  if (showGrid) for (const layer of model.layers) if (!belowGrid(layer)) drawLayer(layer);

  // Координаты — голос Label (§1.5, P1-3): Oswald полужирным, капс по построению
  // (A1…), трекинг .08em; запасной стек — --font-ui. Только если клетка крупнее 18 px.
  if (showCoords && scale >= 18) {
    ctx.fillStyle = chrome.muted;
    ctx.font = `500 ${Math.min(11, Math.round(scale * 0.32))}px ${fonts.label}`;
    if ("letterSpacing" in ctx) {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0.08em";
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let y = vy0; y <= vy1; y++)
      for (let x = vx0; x <= vx1; x++) {
        const { cx, cy } = cellCenter(grid, x, y);
        ctx.fillText(coordLabel(x, y), X(cx), Y(cy));
      }
    // Трекинг — только координатам: дальше идут подписи своим кеглем.
    if ("letterSpacing" in ctx) {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
    }
  }

  for (const drawToken of tokenDraws) drawToken();

  const exploration = model.exploration;
  if (exploration?.enabled && (playerView || o.fogGuide)) {
    ctx.save();
    ctx.fillStyle = "#17252A";
    ctx.globalAlpha = playerView ? 1 : 0.58;
    for (let y = vy0; y <= vy1; y++) for (let x = vx0; x <= vx1; x++) {
      if (exploration.revealedCells.has(`${x},${y}`)) continue;
      traceCell(x, y);
      ctx.fill();
    }
    ctx.restore();
  }

  // (drawLabel определён выше, рядом с остальными layer-проходами.)

  // Подсветка под курсором: футпринт кисти, иначе одиночная клетка.
  const highlights =
    o.hoverCells && o.hoverCells.length > 0 ? o.hoverCells : o.hover ? [o.hover] : [];
  for (const hk of highlights) {
    const [x, y] = hk.split(",").map(Number);
    if (Number.isInteger(x) && Number.isInteger(y)) {
      traceCell(x, y);
      ctx.fillStyle = chrome.ink;
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  if (o.frame !== undefined) {
    // Рамка карты: поля в клетках вокруг неё. Всё, что дальше, — уже не карта.
    const b = worldBounds(grid, width, height), x0 = X(b.minX - o.frame), y0 = Y(b.minY - o.frame), w = (b.maxX - b.minX + o.frame * 2) * scale, h = (b.maxY - b.minY + o.frame * 2) * scale;
    ctx.beginPath(); ctx.rect(-1, -1, canvasW + 2, canvasH + 2); ctx.rect(x0, y0, w, h);
    ctx.fillStyle = "#24211d"; ctx.fill("evenodd");
    ctx.strokeStyle = chrome.ink; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, w, h);
  }

  ctx.restore();
}

// Сериализация в blob колонки `cells`: равнина без дороги не пишется.
// Старший формат диктуется содержимым: маркеры/реки → v4, объекты → v3, подписи → v2, иначе v1.
export function serializeCells(cells: MapCells): string {
  const plain: Record<string, string> = {};
  for (const [k, t] of cells.terrain) {
    if (t !== "plain") plain[k] = t;
  }
  const hasObjects =
    cells.rooms.length > 0 ||
    cells.doors.length > 0 ||
    cells.traps.length > 0 ||
    cells.start !== null ||
    cells.finish !== null;
  const hasV4 = cells.markers.length > 0 || cells.rivers.size > 0;
  if (hasV4) {
    return JSON.stringify({
      v: 4,
      cells: plain,
      roads: [...cells.roads],
      rivers: [...cells.rivers],
      labels: cells.labels,
      rooms: cells.rooms,
      doors: cells.doors,
      traps: cells.traps,
      markers: cells.markers,
      start: cells.start,
      finish: cells.finish,
    });
  }
  if (hasObjects) {
    return JSON.stringify({
      v: 3,
      cells: plain,
      roads: [...cells.roads],
      labels: cells.labels,
      rooms: cells.rooms,
      doors: cells.doors,
      traps: cells.traps,
      start: cells.start,
      finish: cells.finish,
    });
  }
  if (cells.labels.length === 0) {
    return JSON.stringify({ v: 1, cells: plain, roads: [...cells.roads] });
  }
  return JSON.stringify({ v: 2, cells: plain, roads: [...cells.roads], labels: cells.labels });
}

// Миниатюра для списка: тот же рендер, ужатый в ~320 px. Битый canvas
// (приватный режим и т.п.) — null, список покажет заглушку.
// Фаза 2G: V5 document → V5 RenderModel (§49 ТЗ), без LegacyRenderModel.
export function renderThumbnail(
  grid: MapGrid,
  width: number,
  height: number,
  doc: MapDocumentV5,
  chrome: MapChrome
): string | null {
  try {
    const W = 320;
    // Границы — из общего worldBounds (P2-8): раньше здесь жила своя копия
    // формулы для гексов (численно та же, но разъезжалась бы молча).
    const wb = worldBounds(grid, width, height);
    const scale = Math.min(W / (wb.maxX - wb.minX), 200 / (wb.maxY - wb.minY));
    const H = Math.max(1, Math.round((wb.maxY - wb.minY) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    renderMap(ctx, W, H, {
      grid,
      width,
      height,
      model: createV5RenderModel(doc).model,
      scale,
      ox: -wb.minX * scale,
      oy: -wb.minY * scale,
      showGrid: false,
      showCoords: false,
      hover: null,
      chrome,
      // Миниатюра — мастерская (полная): для игрока список и так фильтруется.
      playerView: false,
      selectedId: null,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
