// Semantic equivalence checker (Фаза 2C, §12–28 ТЗ).
// Сравнивает legacy MapCells и MapDocumentV5 напрямую, НЕ вызывая
// migrateLegacyMap и НЕ импортируя его internals. Общая база — только
// grid.ts (cellCenter/cellCorners) и контракт IDs из ids.ts (формат
// `legacy-<kind>-N` — часть спеки ADR §D.4, не алгоритма миграции).
// Таблицы edge-midpoint/orientation продублированы здесь литералами
// по ADR §D.1 намеренно: независимая реализация правила спеки.

import { cellCenter, cellCorners } from "../grid";
import type { MapGrid } from "../mapTypes";
import type { MapCells, MapDoor } from "../render";
import {
  LEGACY_FINISH_ID,
  LEGACY_LAYER_SKELETON,
  LEGACY_START_ID,
  legacyDoorId,
  legacyLabelId,
  legacyMarkerId,
  legacyPathId,
  legacyRoomId,
  legacyTrapId,
} from "./ids";
import type { JsonValue } from "./json";
import type {
  GameplayEntity,
  MapDocumentV5,
  MapLayer,
} from "./types";

export interface SemanticEquivalenceIssue {
  code: string;
  path: string;
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
}

export interface LegacyAuditInput {
  grid: MapGrid;
  width: number;
  height: number;
  cells: MapCells;
}

function issue(
  code: string,
  path: string,
  message: string,
  expected?: JsonValue,
  actual?: JsonValue,
): SemanticEquivalenceIssue {
  return { code, path, message, expected, actual };
}

// ADR §D.1, независимая копия: середина ребра (n:(x+.5,y), s:(x+.5,y+1),
// w:(x,y+.5), e:(x+1,y+.5)) через центр клетки + оффсет.
const EDGE_OFFSET: Record<MapDoor["edge"], { dx: number; dy: number }> = {
  n: { dx: 0, dy: -0.5 },
  s: { dx: 0, dy: 0.5 },
  w: { dx: -0.5, dy: 0 },
  e: { dx: 0.5, dy: 0 },
};

const EDGE_ORIENTATION: Record<MapDoor["edge"], number> = {
  n: 0,
  e: 90,
  s: 180,
  w: 270,
};

function center(grid: MapGrid, x: number, y: number): { x: number; y: number } {
  const c = cellCenter(grid, x, y);
  return { x: c.cx, y: c.cy };
}

function samePos(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function layerById(doc: MapDocumentV5, id: string): MapLayer | undefined {
  return doc.layers.find((l) => l.id === id);
}

function checkGrid(input: LegacyAuditInput, doc: MapDocumentV5, out: SemanticEquivalenceIssue[]): void {
  const { grid, width, height } = input;
  const g = doc.grid;
  if (g === null) {
    out.push(issue("grid-missing", "grid", "migrated document has no grid"));
    return;
  }
  if (g.type !== grid) {
    out.push(issue("grid-type-mismatch", "grid.type", `expected ${grid}`, grid, g.type));
  }
  if (g.columns !== width) {
    out.push(issue("grid-columns-mismatch", "grid.columns", `expected ${width}`, width, g.columns));
  }
  if (g.rows !== height) {
    out.push(issue("grid-rows-mismatch", "grid.rows", `expected ${height}`, height, g.rows));
  }
  if (g.cellSize !== 1) {
    out.push(issue("grid-cellsize-mismatch", "grid.cellSize", "expected 1", 1, g.cellSize));
  }
  if (g.origin.x !== 0 || g.origin.y !== 0) {
    out.push(issue("grid-origin-mismatch", "grid.origin", "expected {x:0,y:0}", { x: 0, y: 0 } as JsonValue, { x: g.origin.x, y: g.origin.y } as JsonValue));
  }
  const b = doc.world.bounds;
  if (grid === "square") {
    const exp = { minX: 0, minY: 0, maxX: width, maxY: height };
    if (b.minX !== exp.minX || b.minY !== exp.minY || b.maxX !== exp.maxX || b.maxY !== exp.maxY) {
      out.push(issue("grid-bounds-mismatch", "world.bounds", "expected [0,W]x[0,H]", exp as unknown as JsonValue, { ...b } as unknown as JsonValue));
    }
    return;
  }
  // Hex: независимый пересчёт bbox углов через grid.ts.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const p of cellCorners("hex", x, y)) {
        if (p.px < minX) minX = p.px;
        if (p.py < minY) minY = p.py;
        if (p.px > maxX) maxX = p.px;
        if (p.py > maxY) maxY = p.py;
      }
    }
  }
  if (b.minX !== minX || b.minY !== minY || b.maxX !== maxX || b.maxY !== maxY) {
    out.push(
      issue("grid-bounds-mismatch", "world.bounds", "hex bounds differ from cellCorners bbox",
        { minX, minY, maxX, maxY } as unknown as JsonValue, { ...b } as unknown as JsonValue),
    );
  }
}

function checkSkeleton(doc: MapDocumentV5, out: SemanticEquivalenceIssue[]): void {
  if (doc.layers.length !== LEGACY_LAYER_SKELETON.length) {
    out.push(
      issue("layer-count-mismatch", "layers", `expected ${LEGACY_LAYER_SKELETON.length} layers`,
        LEGACY_LAYER_SKELETON.length, doc.layers.length),
    );
    return;
  }
  LEGACY_LAYER_SKELETON.forEach((s, i) => {
    const l = doc.layers[i];
    const p = `layers[${i}]`;
    if (l.id !== s.id) out.push(issue("layer-id-mismatch", `${p}.id`, `expected ${s.id}`, s.id, l.id));
    if (l.kind !== s.kind) out.push(issue("layer-kind-mismatch", `${p}.kind`, `expected ${s.kind}`, s.kind, l.kind));
    if (l.name !== s.name) out.push(issue("layer-name-mismatch", `${p}.name`, `expected ${s.name}`, s.name, l.name));
    if (l.visible !== s.visible) out.push(issue("layer-flag-mismatch", `${p}.visible`, "expected true", true, l.visible));
    if (l.locked !== s.locked) out.push(issue("layer-flag-mismatch", `${p}.locked`, "expected false", false, l.locked));
    if (l.opacity !== s.opacity) out.push(issue("layer-flag-mismatch", `${p}.opacity`, "expected 1", 1, l.opacity));
  });
}

function checkTerrain(input: LegacyAuditInput, doc: MapDocumentV5, out: SemanticEquivalenceIssue[]): void {
  const l = layerById(doc, LEGACY_LAYER_SKELETON[0].id);
  if (!l || l.kind !== "terrain") {
    out.push(issue("layer-kind-mismatch", "layers[0]", "expected terrain layer"));
    return;
  }
  const dm = l.defaultMaterial;
  if (dm.type !== "builtin" || dm.key !== "terrain/plain") {
    out.push(issue("terrain-default-material", "layers[0].defaultMaterial", "expected builtin:terrain/plain"));
  }
  if (l.representation !== "cells") {
    out.push(issue("terrain-representation", "layers[0]", "legacy migration must produce cells terrain"));
    return;
  }
  // Ожидаемое множество: legacy non-plain клетки.
  const expected = new Map<string, string>();
  for (const [key, code] of input.cells.terrain) {
    if (code === "plain") continue;
    expected.set(key, code);
  }
  const actual = new Map<string, string>();
  for (const c of l.cells) {
    const m = c.material;
    actual.set(`${c.x},${c.y}`, m.type === "builtin" ? m.key : `asset:${m.assetId}`);
  }
  for (const [key, code] of expected) {
    const got = actual.get(key);
    if (got === undefined) {
      out.push(issue("terrain-missing", `terrain ${key}`, `legacy cell ${key} (${code}) missing in V5`, code, null));
    } else if (got !== `terrain/${code}`) {
      out.push(issue("terrain-material-mismatch", `terrain ${key}`, `expected terrain/${code}`, `terrain/${code}`, got));
    }
  }
  for (const key of actual.keys()) {
    if (!expected.has(key)) {
      out.push(issue("terrain-extra", `terrain ${key}`, "extra V5 cell without legacy source", null, key));
    }
  }
}

function checkPathSet(
  doc: MapDocumentV5,
  layerId: string,
  kind: "road" | "river",
  legacy: Set<string>,
  out: SemanticEquivalenceIssue[],
): void {
  const l = layerById(doc, layerId);
  if (!l || l.kind !== "path") {
    out.push(issue("layer-kind-mismatch", layerId, `expected path layer ${layerId}`));
    return;
  }
  if (legacy.size === 0) {
    if (l.paths.length !== 0) {
      out.push(issue("path-extra", `${layerId}.paths`, `expected no ${kind} paths`, 0, l.paths.length));
    }
    return;
  }
  if (l.paths.length !== 1) {
    out.push(issue("path-count-mismatch", `${layerId}.paths`, `expected 1 ${kind} path`, 1, l.paths.length));
    return;
  }
  const p = l.paths[0];
  const pp = `${layerId}.paths[0]`;
  if (p.id !== legacyPathId(kind)) {
    out.push(issue("path-id-mismatch", `${pp}.id`, `expected ${legacyPathId(kind)}`, legacyPathId(kind), p.id));
  }
  if (p.kind !== kind) {
    out.push(issue("path-kind-mismatch", `${pp}.kind`, `expected ${kind}`, kind, p.kind));
  }
  if (p.width !== 1) {
    out.push(issue("path-width-mismatch", `${pp}.width`, "expected legacy default 1", 1, p.width));
  }
  const st = p.styleRef;
  if (st.type !== "builtin" || st.key !== kind) {
    out.push(issue("path-style-mismatch", `${pp}.styleRef`, `expected builtin:${kind}`));
  }
  if (p.geometry.type !== "cell-network") {
    out.push(issue("path-geometry-mismatch", `${pp}.geometry`, "expected cell-network"));
    return;
  }
  const actual = new Set(p.geometry.cells.map((c) => `${c.x},${c.y}`));
  for (const k of legacy) {
    if (!actual.has(k)) out.push(issue(`${kind}-cell-missing`, `${pp} ${k}`, `legacy ${kind} cell missing`, k, null));
  }
  for (const k of actual) {
    if (!legacy.has(k)) out.push(issue(`${kind}-cell-extra`, `${pp} ${k}`, `extra ${kind} cell`, null, k));
  }
}

function checkLabels(input: LegacyAuditInput, doc: MapDocumentV5, out: SemanticEquivalenceIssue[]): void {
  const l = layerById(doc, LEGACY_LAYER_SKELETON[6].id);
  if (!l || l.kind !== "label") {
    out.push(issue("layer-kind-mismatch", "lyr-labels", "expected label layer"));
    return;
  }
  const src = input.cells.labels;
  if (l.items.length !== src.length) {
    out.push(issue("label-count-mismatch", "lyr-labels.items", "label count differs", src.length, l.items.length));
    return;
  }
  src.forEach((s, i) => {
    const e = l.items[i];
    const p = `lyr-labels.items[${i}]`;
    if (e.id !== legacyLabelId(i)) {
      out.push(issue("label-id-mismatch", `${p}.id`, `expected ${legacyLabelId(i)}`, legacyLabelId(i), e.id));
    }
    if (e.text !== s.text) {
      out.push(issue("label-text-mismatch", `${p}.text`, "text differs", s.text, e.text));
    }
    const exp = center(input.grid, s.x, s.y);
    if (!samePos(e.position, exp)) {
      out.push(issue("label-position-mismatch", `${p}.position`, "position differs from cellCenter",
        exp as unknown as JsonValue, { ...e.position } as unknown as JsonValue));
    }
  });
}

function gameplayItems(doc: MapDocumentV5): GameplayEntity[] | undefined {
  const l = layerById(doc, LEGACY_LAYER_SKELETON[5].id);
  if (!l || l.kind !== "gameplay") return undefined;
  return l.items;
}

function checkRooms(input: LegacyAuditInput, items: GameplayEntity[], out: SemanticEquivalenceIssue[]): void {
  const rooms = items.filter((e) => e.kind === "room");
  const src = input.cells.rooms;
  if (rooms.length !== src.length) {
    out.push(issue("room-count-mismatch", "gameplay", "room count differs", src.length, rooms.length));
    return;
  }
  src.forEach((s, i) => {
    const r = rooms[i];
    const p = `gameplay.rooms[${i}]`;
    if (r.id !== legacyRoomId(i)) {
      out.push(issue("room-id-mismatch", `${p}.id`, `expected ${legacyRoomId(i)}`, legacyRoomId(i), r.id));
    }
    if (r.kind !== "room") return;
    const g = r.geometry;
    if (g.type !== "rect" || g.x !== s.x || g.y !== s.y || g.w !== s.w || g.h !== s.h) {
      out.push(issue("room-geometry-mismatch", `${p}.geometry`, "rect differs",
        { type: "rect", x: s.x, y: s.y, w: s.w, h: s.h } as unknown as JsonValue,
        { ...g } as unknown as JsonValue));
    }
    if (r.roomType !== s.type) {
      out.push(issue("room-type-mismatch", `${p}.roomType`, "type differs", s.type, r.roomType));
    }
    if (r.name !== s.name) {
      out.push(issue("room-name-mismatch", `${p}.name`, "name differs", s.name, r.name));
    }
  });
}

function checkDoors(input: LegacyAuditInput, items: GameplayEntity[], out: SemanticEquivalenceIssue[]): void {
  const doors = items.filter((e) => e.kind === "door");
  const src = input.cells.doors;
  if (doors.length !== src.length) {
    out.push(issue("door-count-mismatch", "gameplay", "door count differs", src.length, doors.length));
    return;
  }
  src.forEach((s, i) => {
    const d = doors[i];
    const p = `gameplay.doors[${i}]`;
    if (d.id !== legacyDoorId(i)) {
      out.push(issue("door-id-mismatch", `${p}.id`, `expected ${legacyDoorId(i)}`, legacyDoorId(i), d.id));
    }
    if (d.kind !== "door") return;
    const c = cellCenter(input.grid, s.x, s.y);
    const off = EDGE_OFFSET[s.edge];
    const exp = { x: c.cx + off.dx, y: c.cy + off.dy };
    if (!samePos(d.position, exp)) {
      out.push(issue("door-position-mismatch", `${p}.position`, "position differs from edge midpoint",
        exp as unknown as JsonValue, { ...d.position } as unknown as JsonValue));
    }
    if (d.orientation !== EDGE_ORIENTATION[s.edge]) {
      out.push(issue("door-orientation-mismatch", `${p}.orientation`, "orientation differs",
        EDGE_ORIENTATION[s.edge], d.orientation));
    }
    if (d.doorKind !== s.kind) {
      out.push(issue("door-kind-mismatch", `${p}.doorKind`, "kind differs", s.kind, d.doorKind));
    }
    if (d.secret !== s.secret) {
      out.push(issue("door-secret-mismatch", `${p}.secret`, "secret flag differs", s.secret, d.secret));
    }
  });
}

/** Независимый пересчёт ожидаемых пар по ADR §D.5 из токенов legacy. */
function checkDoorPairs(input: LegacyAuditInput, items: GameplayEntity[], out: SemanticEquivalenceIssue[]): void {
  const doors = items.filter((e) => e.kind === "door");
  const groups = new Map<string, number[]>();
  input.cells.doors.forEach((d, i) => {
    if (d.pair === null) return;
    const list = groups.get(d.pair) ?? [];
    list.push(i);
    groups.set(d.pair, list);
  });
  const expected = new Map<number, number | null>();
  for (const idxs of groups.values()) {
    const sorted = [...idxs].sort((a, b) => a - b);
    if (sorted.length === 1) {
      expected.set(sorted[0], null);
    } else {
      for (let k = 0; k + 1 < sorted.length; k += 2) {
        expected.set(sorted[k], sorted[k + 1]);
        expected.set(sorted[k + 1], sorted[k]);
      }
      if (sorted.length % 2 === 1) expected.set(sorted[sorted.length - 1], null);
    }
  }
  input.cells.doors.forEach((s, i) => {
    const d = doors[i];
    if (!d || d.kind !== "door") return;
    const expIdx = s.pair === null ? null : (expected.get(i) ?? null);
    const expId = expIdx === null ? null : legacyDoorId(expIdx);
    if (d.pairedDoorId !== expId) {
      out.push(issue("door-pair-mismatch", `gameplay.doors[${i}].pairedDoorId`,
        `expected ${expId ?? "null"} by ADR pair rule`, expId, d.pairedDoorId));
    }
  });
}

function checkTraps(input: LegacyAuditInput, items: GameplayEntity[], out: SemanticEquivalenceIssue[]): void {
  const traps = items.filter((e) => e.kind === "trap");
  const src = input.cells.traps;
  if (traps.length !== src.length) {
    out.push(issue("trap-count-mismatch", "gameplay", "trap count differs", src.length, traps.length));
    return;
  }
  src.forEach((s, i) => {
    const t = traps[i];
    const p = `gameplay.traps[${i}]`;
    if (t.id !== legacyTrapId(i)) {
      out.push(issue("trap-id-mismatch", `${p}.id`, `expected ${legacyTrapId(i)}`, legacyTrapId(i), t.id));
    }
    if (t.kind !== "trap") return;
    if (t.trapKind !== s.kind) {
      out.push(issue("trap-kind-mismatch", `${p}.trapKind`, "kind differs", s.kind, t.trapKind));
    }
    const exp = center(input.grid, s.x, s.y);
    if (!samePos(t.position, exp)) {
      out.push(issue("trap-position-mismatch", `${p}.position`, "position differs from cellCenter",
        exp as unknown as JsonValue, { ...t.position } as unknown as JsonValue));
    }
  });
}

function checkMarkers(input: LegacyAuditInput, items: GameplayEntity[], out: SemanticEquivalenceIssue[]): void {
  const markers = items.filter((e) => e.kind === "marker");
  const src = input.cells.markers;
  if (markers.length !== src.length) {
    out.push(issue("marker-count-mismatch", "gameplay", "marker count differs", src.length, markers.length));
    return;
  }
  src.forEach((s, i) => {
    const m = markers[i];
    const p = `gameplay.markers[${i}]`;
    if (m.id !== legacyMarkerId(i)) {
      out.push(issue("marker-id-mismatch", `${p}.id`, `expected ${legacyMarkerId(i)}`, legacyMarkerId(i), m.id));
    }
    if (m.kind !== "marker") return;
    if (m.markerKind !== s.kind) {
      out.push(issue("marker-kind-mismatch", `${p}.markerKind`, "kind differs", s.kind, m.markerKind));
    }
    const exp = center(input.grid, s.x, s.y);
    if (!samePos(m.position, exp)) {
      out.push(issue("marker-position-mismatch", `${p}.position`, "position differs from cellCenter",
        exp as unknown as JsonValue, { ...m.position } as unknown as JsonValue));
    }
  });
}

function checkStartFinish(input: LegacyAuditInput, items: GameplayEntity[], out: SemanticEquivalenceIssue[]): void {
  const starts = items.filter((e) => e.kind === "start");
  const finishes = items.filter((e) => e.kind === "finish");
  if (input.cells.start === null) {
    if (starts.length !== 0) out.push(issue("start-extra", "gameplay", "unexpected start entity", null, starts.length));
  } else {
    if (starts.length !== 1) {
      out.push(issue("start-count-mismatch", "gameplay", "expected 1 start", 1, starts.length));
    } else {
      const s = starts[0];
      if (s.id !== LEGACY_START_ID) {
        out.push(issue("start-id-mismatch", "gameplay.start.id", `expected ${LEGACY_START_ID}`, LEGACY_START_ID, s.id));
      }
      if (s.kind === "start") {
        const exp = center(input.grid, input.cells.start.x, input.cells.start.y);
        if (!samePos(s.position, exp)) {
          out.push(issue("start-position-mismatch", "gameplay.start.position", "position differs from cellCenter",
            exp as unknown as JsonValue, { ...s.position } as unknown as JsonValue));
        }
      }
    }
  }
  if (input.cells.finish === null) {
    if (finishes.length !== 0) out.push(issue("finish-extra", "gameplay", "unexpected finish entity", null, finishes.length));
  } else {
    if (finishes.length !== 1) {
      out.push(issue("finish-count-mismatch", "gameplay", "expected 1 finish", 1, finishes.length));
    } else {
      const f = finishes[0];
      if (f.id !== LEGACY_FINISH_ID) {
        out.push(issue("finish-id-mismatch", "gameplay.finish.id", `expected ${LEGACY_FINISH_ID}`, LEGACY_FINISH_ID, f.id));
      }
      if (f.kind === "finish") {
        const exp = center(input.grid, input.cells.finish.x, input.cells.finish.y);
        if (!samePos(f.position, exp)) {
          out.push(issue("finish-position-mismatch", "gameplay.finish.position", "position differs from cellCenter",
            exp as unknown as JsonValue, { ...f.position } as unknown as JsonValue));
        }
      }
    }
  }
}

const GROUP_RANK: Record<string, number> = {
  room: 0,
  door: 1,
  trap: 2,
  marker: 3,
  start: 4,
  finish: 5,
};

function checkGameplayOrder(items: GameplayEntity[], out: SemanticEquivalenceIssue[]): void {
  let maxRank = -1;
  items.forEach((e, i) => {
    const rank = GROUP_RANK[e.kind];
    if (rank === undefined) {
      out.push(issue("unexpected-entity", `gameplay.items[${i}]`, `unknown gameplay kind ${(e as { kind: string }).kind}`));
      return;
    }
    if (rank < maxRank) {
      out.push(issue("gameplay-order-mismatch", `gameplay.items[${i}]`,
        `expected canonical order rooms→doors→traps→markers→start→finish, got ${e.kind} after rank ${maxRank}`));
      return;
    }
    maxRank = rank;
  });
}

function checkEmptyObjectScatter(doc: MapDocumentV5, out: SemanticEquivalenceIssue[]): void {
  // У legacy нет источника objects/scatter-контента: любое содержимое — extra.
  const objects = layerById(doc, LEGACY_LAYER_SKELETON[3].id);
  if (objects && objects.kind === "object" && objects.items.length !== 0) {
    out.push(issue("unexpected-entity", "lyr-objects.items", "legacy has no objects source", 0, objects.items.length));
  }
  const scatter = layerById(doc, LEGACY_LAYER_SKELETON[4].id);
  if (scatter && scatter.kind === "scatter" && scatter.areas.length !== 0) {
    out.push(issue("unexpected-entity", "lyr-scatter.areas", "legacy has no scatter source", 0, scatter.areas.length));
  }
}

/**
 * Независимая проверка семантической эквивалентности legacy → V5.
 * Не мутирует входы. Пустой массив = exact equivalence.
 */
export function compareLegacySemantics(
  input: LegacyAuditInput,
  doc: MapDocumentV5,
): SemanticEquivalenceIssue[] {
  const out: SemanticEquivalenceIssue[] = [];
  checkGrid(input, doc, out);
  checkSkeleton(doc, out);
  checkTerrain(input, doc, out);
  checkPathSet(doc, LEGACY_LAYER_SKELETON[2].id, "road", input.cells.roads, out);
  checkPathSet(doc, LEGACY_LAYER_SKELETON[1].id, "river", input.cells.rivers, out);
  checkLabels(input, doc, out);
  const items = gameplayItems(doc);
  if (!items) {
    out.push(issue("layer-kind-mismatch", "lyr-gameplay", "expected gameplay layer"));
  } else {
    checkRooms(input, items, out);
    checkDoors(input, items, out);
    checkDoorPairs(input, items, out);
    checkTraps(input, items, out);
    checkMarkers(input, items, out);
    checkStartFinish(input, items, out);
    checkGameplayOrder(items, out);
  }
  checkEmptyObjectScatter(doc, out);
  return out;
}
