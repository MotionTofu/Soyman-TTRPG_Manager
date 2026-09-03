// Рендер карты на canvas 2D. Цвета террейна — фиксированная спокойная
// палитра (исключение как у Полотна §6 design_revision.md: бюджет акцента
// на неё не тратится). Обрамление (фон, сетка, координаты, дороги) — из
// токенов текущей темы, читаются один раз за кадр.

import { cellCenter, cellCorners, coordLabel, neighbors, worldBounds } from "./grid";
import type { MapGrid, MapScale } from "./mapTypes";

// Порядок — как кисти в тулбаре; индекс используется в миниатюрах? Нет,
// коды террейна хранятся строками, порядок здесь только для документации.
export const MAP_TERRAIN_ORDER = [
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

export const MAP_ROOM_TYPES = ["empty", "barracks", "temple", "treasury", "prison", "lab"] as const;
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

export const MAP_DOOR_KINDS = ["arch", "door", "locked", "trapped", "secret", "portc"] as const;
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

export const MAP_TRAP_KINDS = ["pit", "arrow", "gas", "glyph"] as const;
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
export const MAP_MARKER_KINDS = ["chest", "altar", "city", "village", "camp", "metro", "battle", "obelisk"] as const;
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
  cells: MapCells;
  // Камера: scale = экранных px на мировую единицу, ox/oy = сдвиг в px.
  scale: number;
  ox: number;
  oy: number;
  showGrid: boolean;
  showCoords: boolean;
  // Подсветка клетки под курсором (мировые "x,y" или null).
  hover: string | null;
  // Футпринт кисти 2/3 (Этап G): если задан непустым — подсвечивается он, иначе hover.
  hoverCells?: string[] | null;
  chrome: MapChrome;
  // Взгляд игрока (пакет A §6): секретное скрыто, trapped видна обычной дверью.
  playerView: boolean;
  // Выбранный объект для подсветки (`door:3`, `trap:0`, `room:1`, `start`, `finish`).
  selectedKey: string | null;
}

// Дверь глазами смотрящего: секрет → скрыть, trapped игроку → обычная.
export function doorForView(d: MapDoor, playerView: boolean): { kind: MapDoorKind; hidden: boolean } {
  if (!playerView) return { kind: d.kind, hidden: false };
  if (d.kind === "secret" || d.secret) return { kind: d.kind, hidden: true };
  if (d.kind === "trapped") return { kind: "door", hidden: false };
  return { kind: d.kind, hidden: false };
}

export function renderMap(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number, o: RenderOptions): void {
  const { grid, width, height, cells, scale, ox, oy, showGrid, showCoords, hover, chrome, playerView, selectedKey } = o;
  const fonts = readCanvasFonts();
  ctx.save();
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = chrome.paper;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const X = (wx: number) => ox + wx * scale;
  const Y = (wy: number) => oy + wy * scale;

  // Видимый диапазон клеток (P1-5): за экраном не красим. Запас 1 клетка —
  // гексы соседних колонок заглядывают за свою ось.
  const inView = (x: number, y: number) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
  const vx0 = Math.max(0, Math.floor(-ox / scale) - 1);
  const vy0 = Math.max(0, Math.floor(-oy / scale) - 1);
  const vx1 = Math.min(width - 1, Math.ceil((canvasW - ox) / scale) + 1);
  const vy1 = Math.min(height - 1, Math.ceil((canvasH - oy) / scale) + 1);

  const traceCell = (x: number, y: number) => {
    const pts = cellCorners(grid, x, y);
    ctx.beginPath();
    ctx.moveTo(X(pts[0].px), Y(pts[0].py));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].px), Y(pts[i].py));
    ctx.closePath();
  };

  // Клетки: по умолчанию равнина (заливка всего поля одним проходом),
  // поверх — только расписанные и только видимые.
  ctx.fillStyle = MAP_TERRAIN_FILL.plain;
  if (grid === "square") {
    ctx.fillRect(X(0), Y(0), width * scale, height * scale);
  } else {
    for (let y = vy0; y <= vy1; y++)
      for (let x = vx0; x <= vx1; x++) {
        traceCell(x, y);
        ctx.fill();
      }
  }
  const byTerrain = new Map<string, { x: number; y: number }[]>();
  for (const [key, t] of cells.terrain) {
    const [x, y] = key.split(",").map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) continue;
    if (t === "plain" || !inView(x, y)) continue;
    const list = byTerrain.get(t) ?? [];
    list.push({ x, y });
    byTerrain.set(t, list);
  }
  for (const [t, list] of byTerrain) {
    ctx.fillStyle = MAP_TERRAIN_FILL[t] ?? MAP_TERRAIN_FILL.plain;
    for (const { x, y } of list) {
      traceCell(x, y);
      ctx.fill();
    }
  }

  // Штриховка расписанных клеток (пакет B): только видимые, только крупно.
  if (scale >= 16) {
    ctx.save();
    ctx.lineWidth = Math.max(1, scale * 0.06);
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.32;
    for (const [key, t] of cells.terrain) {
      if (t === "plain") continue;
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
  }

  // Реки — тем же приёмом, что дороги (линия по центрам), но шире, водой и ПОД
  // дорогами, чтобы мост читался. Бумажная подложка держит читаемость на воде.
  const RIVER_FILL = MAP_RIVER_FILL;
  // Общий трассировщик линейных оверлеев (дороги, реки): путь строится один раз,
  // красится вызывающим (реке нужны два прохода: бумажная подложка + вода).
  const traceOverlayLine = (set: Set<string>) => {
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
  if (cells.rivers.size > 0) {
    ctx.lineCap = "round";
    ctx.beginPath();
    traceOverlayLine(cells.rivers);
    ctx.strokeStyle = chrome.paper;
    ctx.lineWidth = Math.max(2, scale * 0.34);
    ctx.stroke();
    ctx.beginPath();
    traceOverlayLine(cells.rivers);
    ctx.strokeStyle = RIVER_FILL;
    ctx.lineWidth = Math.max(1.5, scale * 0.22);
    ctx.stroke();
  }

  // Дороги — линией по центрам соседних дорожных клеток.
  if (cells.roads.size > 0) {
    ctx.strokeStyle = chrome.ink;
    ctx.lineWidth = Math.max(1.5, scale * 0.22);
    ctx.lineCap = "round";
    ctx.beginPath();
    traceOverlayLine(cells.roads);
    ctx.stroke();
  }

  // Слой объектов, пакет A (§3 спеки): тинт комнат → двери → ловушки →
  // старт/финиш. Объекты при scale < 10 не рисуются, глифы/текст — при < 14.
  if (scale >= 10) {
    // Комнаты: тинт типа + номер + имя.
    cells.rooms.forEach((r, idx) => {
      if (!Number.isInteger(r.x) || !Number.isInteger(r.y) || !Number.isInteger(r.w) || !Number.isInteger(r.h)) return;
      if (r.w < 1 || r.h < 1 || r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) return;
      const tint = MAP_ROOM_TINT[r.type];
      if (scale >= 14) {
        const cxp = X(r.x) + (r.w * scale) / 2;
        const cyp = Y(r.y) + (r.h * scale) / 2;
        ctx.save();
        ctx.fillStyle = chrome.muted;
        ctx.globalAlpha = 0.8;
        ctx.font = `${Math.min(10, Math.round(scale * 0.3))}px ${fonts.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // M4: безымянная комната — не голый номер, а «Казарма 3» / «Комната 3».
        ctx.fillText(r.name || (r.type === "empty" ? `Комната ${idx + 1}` : `${MAP_ROOM_LABELS[r.type] ?? r.type} ${idx + 1}`), cxp, cyp);
        ctx.restore();
        if (r.name) {
          ctx.save();
          ctx.fillStyle = chrome.muted;
          ctx.font = `500 ${Math.min(10, Math.round(scale * 0.3))}px ${fonts.label}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(r.name, cxp, Y(r.y) + 2, r.w * scale);
          ctx.restore();
        }
      }
    });

    // Обводка комнат со стороны стен (хотелка 2): сегмент периметра рисуется,
    // только если за ним стена (террейн wall) или край карты; где проём — нет
    // линии; на рёбрах с видимой дверью — пропуск (там уже дверь).
    // На гексах — те же клеточные рёбра через общие вершины полигонов.
    {
      const doorEdges = new Set<string>();
      if (grid === "square") {
        for (const d of cells.doors) {
          // Скрытая дверь у игрока щели в обводке не даёт — иначе спойлер позицией.
          if (doorForView(d, playerView).hidden) continue;
          doorEdges.add(`${d.x},${d.y}:${d.edge}`);
        }
      }
      const wallAt = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= width || y >= height) return true;
        return (cells.terrain.get(`${x},${y}`) ?? "plain") === "wall";
      };
      const inRoom = (r: MapRoom, x: number, y: number): boolean =>
        x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
      const DIRS_SQ: { dx: number; dy: number; edge: "n" | "s" | "e" | "w" }[] = [
        { dx: 0, dy: -1, edge: "n" },
        { dx: 0, dy: 1, edge: "s" },
        { dx: -1, dy: 0, edge: "w" },
        { dx: 1, dy: 0, edge: "e" },
      ];
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = Math.max(1.5, scale * 0.1);
      ctx.lineCap = "butt";
      ctx.beginPath();
      const seg2 = (ax: number, ay: number, bx: number, by: number) => {
        ctx.moveTo(X(ax), Y(ay));
        ctx.lineTo(X(bx), Y(by));
      };
      for (const r of cells.rooms) {
        if (!Number.isInteger(r.x) || !Number.isInteger(r.y) || !Number.isInteger(r.w) || !Number.isInteger(r.h)) continue;
        if (r.w < 1 || r.h < 1 || r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) continue;
        // Грубый отсев заэкранных комнат (гексам запас в клетку на выступы).
        if (X(r.x + r.w) < -scale || X(r.x) > canvasW + scale || Y(r.y + r.h) < -scale || Y(r.y) > canvasH + scale) continue;
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            if (grid === "square") {
              for (const d of DIRS_SQ) {
                const nx = x + d.dx;
                const ny = y + d.dy;
                if (inRoom(r, nx, ny)) continue;
                if (!wallAt(nx, ny)) continue;
                if (doorEdges.has(`${x},${y}:${d.edge}`)) continue;
                if (d.edge === "n") seg2(x, y, x + 1, y);
                else if (d.edge === "s") seg2(x, y + 1, x + 1, y + 1);
                else if (d.edge === "w") seg2(x, y, x, y + 1);
                else seg2(x + 1, y, x + 1, y + 1);
              }
            } else {
              const pts = cellCorners(grid, x, y);
              for (const n of neighbors(grid, x, y)) {
                if (inRoom(r, n.x, n.y)) continue;
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
      }
      ctx.stroke();
      ctx.restore();
    }

    // Двери: тёмная подложка поперёк ребра + цвет вида + глиф.
    // Геометрия рёбер — квадратная; на гексах дверей нет (создание заблокировано),
    // API-инъекцию молча не рисуем, чтобы не врать геометрией.
    for (const [di, d] of cells.doors.entries()) {
      if (grid !== "square") break;
      if (!Number.isInteger(d.x) || !Number.isInteger(d.y) || d.x < 0 || d.y < 0 || d.x >= width || d.y >= height)
        continue;
      if (!inView(d.x, d.y)) continue;
      const { kind, hidden } = doorForView(d, playerView);
      if (hidden) continue;
      const horizontal = d.edge === "n" || d.edge === "s";
      const ex = d.edge === "n" ? Y(d.y) : d.edge === "s" ? Y(d.y + 1) : Y(d.y) + scale / 2;
      const ey = d.edge === "w" ? X(d.x) : d.edge === "e" ? X(d.x + 1) : X(d.x) + scale / 2;
      // Подложка во всю клетку поперёк ребра.
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = Math.max(2, scale * 0.2);
      ctx.lineCap = "butt";
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(X(d.x), ex);
        ctx.lineTo(X(d.x + 1), ex);
      } else {
        ctx.moveTo(ey, Y(d.y));
        ctx.lineTo(ey, Y(d.y + 1));
      }
      ctx.stroke();
      // Плашка вида по центру ребра.
      const pw = horizontal ? scale * 0.72 : Math.max(3, scale * 0.34);
      const ph = horizontal ? Math.max(3, scale * 0.34) : scale * 0.72;
      const px = horizontal ? X(d.x) + (scale - pw) / 2 : ey - pw / 2;
      const py = horizontal ? ex - ph / 2 : Y(d.y) + (scale - ph) / 2;
      ctx.fillStyle = MAP_DOOR_FILL[kind];
      ctx.fillRect(px, py, pw, ph);
      ctx.lineWidth = 1;
      ctx.strokeStyle = chrome.ink;
      if (!playerView && (d.kind === "secret" || d.secret)) ctx.setLineDash([3, 2]);
      ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
      ctx.setLineDash([]);
      if (scale >= 14) {
        ctx.fillStyle = chrome.ink;
        ctx.font = `700 ${Math.min(11, Math.round(scale * 0.32))}px ${fonts.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(MAP_DOOR_GLYPHS[kind], px + pw / 2, py + ph / 2 + 0.5);
      }
      // Выбранная дверь — чернильной обводкой (координатная отметка, §1.8).
      if (selectedKey === `door:${di}`) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = chrome.ink;
        ctx.strokeRect(px - 2.5, py - 2.5, pw + 5, ph + 5);
      }
      ctx.restore();
    }

    // Ловушки: плашка + символ. Игрок их не видит.
    if (!playerView) {
      for (const [ti, t] of cells.traps.entries()) {
        if (!Number.isInteger(t.x) || !Number.isInteger(t.y) || t.x < 0 || t.y < 0 || t.x >= width || t.y >= height)
          continue;
        if (!inView(t.x, t.y)) continue;
        // Центр через cellCenter: на квадратах то же самое, на гексах — по центру гекса.
        const tcc = cellCenter(grid, t.x, t.y);
        const ss = scale * 0.6;
        const sx = X(tcc.cx) - ss / 2;
        const sy = Y(tcc.cy) - ss / 2;
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
        if (selectedKey === `trap:${ti}`) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = chrome.ink;
          ctx.strokeRect(sx - 2.5, sy - 2.5, ss + 5, ss + 5);
        }
        ctx.restore();
      }
    }

    // Маркеры (сундуки, алтари): видны всем, включая игрока. Сундук — плашка
    // с крышкой, алтарь — круг с точкой. Выбранный — чернильной обводкой.
    for (const [mi, mk] of cells.markers.entries()) {
      if (!Number.isInteger(mk.x) || !Number.isInteger(mk.y) || mk.x < 0 || mk.y < 0 || mk.x >= width || mk.y >= height)
        continue;
      if (!inView(mk.x, mk.y)) continue;
      const mcc = cellCenter(grid, mk.x, mk.y);
      const ms = scale * 0.6;
      const mx = X(mcc.cx) - ms / 2;
      const my = Y(mcc.cy) - ms / 2;
      const cx = X(mcc.cx);
      const cy = Y(mcc.cy);
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
      if (selectedKey === `marker:${mi}`) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = chrome.ink;
        ctx.strokeRect(mx - 2.5, my - 2.5, ms + 5, ms + 5);
      }
      ctx.restore();
    }

    // Старт/финиш: видны всем.
    for (const key of ["start", "finish"] as const) {
      const p = cells[key];
      if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= width || p.y >= height)
        continue;
      if (!inView(p.x, p.y)) continue;
      const pcc = cellCenter(grid, p.x, p.y);
      const cxp = X(pcc.cx);
      const cyp = Y(pcc.cy);
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
      if (selectedKey === key) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = chrome.ink;
        ctx.strokeRect(X(p.x) - 2.5, Y(p.y) - 2.5, scale + 5, scale + 5);
      }
      ctx.restore();
    }
  }

  // Сетка 1 px по инварианту.
  if (showGrid) {
    ctx.strokeStyle = chrome.line;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
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
    ctx.globalAlpha = 1;
  }

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

  // Подписи — поверх всего, кроме ничего: текст читается всегда (P2-2).
  // Только на крупном зуме, иначе каша.
  if (o.cells.labels.length > 0 && scale >= 12) {
    ctx.save();
    ctx.font = `500 ${Math.min(13, Math.round(scale * 0.36))}px ${fonts.label}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const l of o.cells.labels) {
      if (!Number.isInteger(l.x) || !Number.isInteger(l.y) || l.x < 0 || l.y < 0 || l.x >= width || l.y >= height)
        continue;
      if (!inView(l.x, l.y)) continue;
      const { cx, cy } = cellCenter(grid, l.x, l.y);
      const px = X(cx);
      const py = Y(cy);
      // Точка-маркер в центре клетки.
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, scale * 0.09), 0, Math.PI * 2);
      ctx.fillStyle = chrome.ink;
      ctx.fill();
      // Текст с бумажной подложкой-обводкой, чтобы читался на любом террейне.
      ctx.lineWidth = 3;
      ctx.strokeStyle = chrome.paper;
      ctx.strokeText(l.text, px, py - scale * 0.12, scale * 8);
      ctx.fillStyle = chrome.ink;
      ctx.fillText(l.text, px, py - scale * 0.12, scale * 8);
    }
    ctx.restore();
  }

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
export function renderThumbnail(
  grid: MapGrid,
  width: number,
  height: number,
  cells: MapCells,
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
      cells,
      scale,
      ox: -wb.minX * scale,
      oy: -wb.minY * scale,
      showGrid: false,
      showCoords: false,
      hover: null,
      chrome,
      // Миниатюра — мастерская (полная): для игрока список и так фильтруется.
      playerView: false,
      selectedKey: null,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
