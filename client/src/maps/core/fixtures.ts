// Фикстуры legacy-карт для Core-тестов (§46 ТЗ).
// Blob'ы идут через настоящий parseCellsBlob — как в production.

import { parseCellsBlob, type MapCells } from "../render";

function blob(v: number, patch: Record<string, unknown>): string {
  return JSON.stringify({ v, ...patch });
}

const V1_EMPTY = blob(1, { cells: {}, roads: [] });

const V1_TERRAIN = blob(1, {
  cells: { "0,0": "forest", "2,1": "mountains", "1,1": "plain" },
  roads: [],
});

const V2_LABELS = blob(2, {
  cells: {},
  roads: [],
  labels: [
    { x: 1, y: 1, text: "Тёмный лес" },
    { x: 3, y: 0, text: "Брод" },
  ],
});

const V3_DUNGEON = blob(3, {
  cells: { "0,0": "wall", "1,0": "wall", "2,0": "stone" },
  roads: [],
  labels: [],
  rooms: [{ x: 2, y: 0, w: 2, h: 2, type: "treasury", name: "Кладовая" }],
  doors: [{ x: 2, y: 0, edge: "n", kind: "door", secret: false, pair: null }],
  traps: [{ x: 3, y: 1, kind: "pit" }],
  start: { x: 0, y: 2 },
  finish: { x: 3, y: 2 },
});

// Полная v4 square: всё сразу.
const V4_FULL_SQUARE = blob(4, {
  cells: { "1,1": "forest", "2,1": "forest", "5,5": "deep_water" },
  roads: ["0,2", "1,2", "2,2"],
  rivers: ["4,0", "4,1", "4,2"],
  labels: [{ x: 1, y: 1, text: "Тёмный лес" }],
  rooms: [
    { x: 2, y: 0, w: 2, h: 2, type: "treasury", name: "Кладовая" },
    { x: 6, y: 6, w: 2, h: 1, type: "empty", name: "" },
  ],
  doors: [
    { x: 2, y: 0, edge: "n", kind: "door", secret: false, pair: null },
    { x: 6, y: 6, edge: "e", kind: "locked", secret: false, pair: "gate" },
    { x: 7, y: 6, edge: "w", kind: "locked", secret: false, pair: "gate" },
    { x: 0, y: 0, edge: "s", kind: "secret", secret: true, pair: null },
    { x: 1, y: 3, edge: "n", kind: "trapped", secret: false, pair: null },
  ],
  traps: [{ x: 3, y: 1, kind: "arrow" }],
  markers: [
    { x: 5, y: 5, kind: "chest" },
    { x: 0, y: 7, kind: "city" },
  ],
  start: { x: 0, y: 7 },
  finish: { x: 7, y: 0 },
});

// Полная v4 hex.
const V4_FULL_HEX = blob(4, {
  cells: { "1,1": "forest", "2,3": "hills" },
  roads: ["0,0", "1,0"],
  rivers: ["3,3"],
  labels: [{ x: 2, y: 2, text: "Холмы" }],
  rooms: [{ x: 4, y: 4, w: 2, h: 2, type: "barracks", name: "Казарма" }],
  doors: [],
  traps: [{ x: 1, y: 2, kind: "gas" }],
  markers: [{ x: 5, y: 1, kind: "village" }],
  start: { x: 0, y: 0 },
  finish: { x: 5, y: 5 },
});

// Дверная пара: ровно 2 двери с одним токеном.
const V3_PAIR = blob(3, {
  cells: {},
  roads: [],
  labels: [],
  rooms: [],
  doors: [
    { x: 1, y: 1, edge: "n", kind: "door", secret: false, pair: "ab" },
    { x: 5, y: 5, edge: "s", kind: "door", secret: false, pair: "ab" },
  ],
  traps: [],
});

// Висячий токен: одна дверь.
const V3_PAIR_SINGLE = blob(3, {
  cells: {},
  roads: [],
  labels: [],
  rooms: [],
  doors: [{ x: 1, y: 1, edge: "n", kind: "door", secret: false, pair: "ghost" }],
  traps: [],
});

// Группа >2: пять дверей с одним токеном (пример из ТЗ: 0↔4, 7↔9, 13→null
// в терминах индексов 0..4 → 0↔1, 2↔3, 4→null).
const V3_PAIR_BIG = blob(3, {
  cells: {},
  roads: [],
  labels: [],
  rooms: [],
  doors: [0, 1, 2, 3, 4].map((i) => ({
    x: i,
    y: 0,
    edge: "n",
    kind: "door",
    secret: false,
    pair: "mob",
  })),
  traps: [],
});

// Только дороги/реки (lossless cell-network).
const V4_PATHS = blob(4, {
  cells: {},
  roads: ["2,0", "0,0", "1,0"],
  rivers: ["1,1", "0,1"],
  labels: [],
  rooms: [],
  doors: [],
  traps: [],
  markers: [],
  start: null,
  finish: null,
});

export const FIXTURES = {
  emptyV1: V1_EMPTY,
  terrainV1: V1_TERRAIN,
  labelsV2: V2_LABELS,
  dungeonV3: V3_DUNGEON,
  fullV4Square: V4_FULL_SQUARE,
  fullV4Hex: V4_FULL_HEX,
  pair: V3_PAIR,
  pairSingle: V3_PAIR_SINGLE,
  pairBig: V3_PAIR_BIG,
  pathsV4: V4_PATHS,
} as const;

export function parseFixture(raw: string): MapCells {
  return parseCellsBlob(raw);
}
