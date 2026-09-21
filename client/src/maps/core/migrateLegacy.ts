// Legacy migration v1–v4 → MapDocumentV5 (ADR-0003 §D).
// Вход — распарсенный MapCells (парсер уже применил per-record валидацию
// и caps). Миграция полностью детерминирована: сортировки + legacy-IDs,
// никакого random/UUID. Направление только Legacy → V5 (§57 ТЗ).
//
// Граничные решения (совпадают с семантикой legacy-рендера, который тоже
// пропускает клетки вне поля):
// - OOB/невалидные ключи terrain/roads/rivers отбрасываются;
// - plain-клетки не пишутся (покрыты defaultMaterial);
// - hex-двери: те же edge-midpoint правила поверх hex-центров, без
//   рёберной модели гексов; hex-комнаты: rect как есть.

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
import { BUILTIN_PLAIN_MATERIAL, BUILTIN_RIVER_STYLE, BUILTIN_ROAD_STYLE, builtinMaterial } from "./refs";
import type {
  GameplayDoor,
  GameplayEntity,
  MapDocumentV5,
  MapGridConfig,
  MapLabel,
  MapLayer,
  MapPath,
  TerrainCellEntry,
  Vec2,
} from "./types";

export interface LegacyMapInput {
  grid: MapGrid;
  width: number;
  height: number;
  cells: MapCells;
}

export interface LegacyMigrationWarning {
  code: "dangling-pair-token" | "oversized-pair-group";
  /** Непрозрачный legacy-токен группы. */
  token: string;
  doorIds: string[];
  message: string;
}

export interface LegacyMigrationResult {
  document: MapDocumentV5;
  warnings: LegacyMigrationWarning[];
}

const DOOR_ORIENTATION: Record<MapDoor["edge"], number> = {
  n: 0,
  e: 90,
  s: 180,
  w: 270,
};

// Смещение середины ребра от центра клетки. Для square даёт точные формулы
// ADR (n:(x+.5,y) и т.д.); для hex — те же правила в hex-world-координатах.
const DOOR_EDGE_OFFSET: Record<MapDoor["edge"], Vec2> = {
  n: { x: 0, y: -0.5 },
  s: { x: 0, y: 0.5 },
  w: { x: -0.5, y: 0 },
  e: { x: 0.5, y: 0 },
};

function parseCellKey(key: string): { x: number; y: number } | null {
  const m = /^(\d+),(\d+)$/.exec(key);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

function buildGrid(grid: MapGrid, width: number, height: number): MapGridConfig {
  const base = {
    cellSize: 1,
    columns: width,
    rows: height,
    origin: { x: 0, y: 0 },
  };
  if (grid === "hex") {
    return { ...base, type: "hex", hex: { orientation: "pointy", offset: "odd-q" } };
  }
  return { ...base, type: "square" };
}

function buildBounds(grid: MapGrid, width: number, height: number): MapDocumentV5["world"]["bounds"] {
  if (grid === "square") {
    return { minX: 0, minY: 0, maxX: width, maxY: height };
  }
  // Hex: bounding box углов ВСЕХ клеток через существующую математику cellCorners.
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
  return { minX, minY, maxX, maxY };
}

function migrateTerrainCells(cells: MapCells, width: number, height: number): TerrainCellEntry[] {
  const out: TerrainCellEntry[] = [];
  for (const [key, code] of cells.terrain) {
    if (code === "plain") continue; // покрыто defaultMaterial
    const p = parseCellKey(key);
    if (!p) continue;
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue; // как рендер
    out.push({ x: p.x, y: p.y, material: builtinMaterial(code) });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

function migratePathCells(set: Set<string>, width: number, height: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const key of set) {
    const p = parseCellKey(key);
    if (!p) continue;
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue;
    out.push({ x: p.x, y: p.y });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

function cellPos(grid: MapGrid, x: number, y: number): Vec2 {
  const c = cellCenter(grid, x, y);
  return { x: c.cx, y: c.cy };
}

export function migrateLegacyMap(input: LegacyMapInput): LegacyMigrationResult {
  const { grid, width, height, cells } = input;
  const warnings: LegacyMigrationWarning[] = [];

  // --- Terrain layer ---
  const terrainCells = migrateTerrainCells(cells, width, height);

  // --- Path layers (один path на kind; пустой set → пустой paths[]) ---
  const riverCells = migratePathCells(cells.rivers, width, height);
  const roadCells = migratePathCells(cells.roads, width, height);
  const riverPaths: MapPath[] =
    riverCells.length > 0
      ? [
          {
            id: legacyPathId("river"),
            kind: "river",
            geometry: { type: "cell-network", cells: riverCells },
            width: 1,
            styleRef: BUILTIN_RIVER_STYLE,
          },
        ]
      : [];
  const roadPaths: MapPath[] =
    roadCells.length > 0
      ? [
          {
            id: legacyPathId("road"),
            kind: "road",
            geometry: { type: "cell-network", cells: roadCells },
            width: 1,
            styleRef: BUILTIN_ROAD_STYLE,
          },
        ]
      : [];

  // --- Labels ---
  const labels: MapLabel[] = cells.labels.map((l, i) => ({
    id: legacyLabelId(i),
    position: cellPos(grid, l.x, l.y),
    text: l.text,
  }));

  // --- Gameplay: rooms → doors → traps → markers → start → finish ---
  const gameplay: GameplayEntity[] = [];
  cells.rooms.forEach((r, i) => {
    gameplay.push({
      id: legacyRoomId(i),
      kind: "room",
      geometry: { type: "rect", x: r.x, y: r.y, w: r.w, h: r.h },
      roomType: r.type,
      name: r.name,
    });
  });

  // Двери: обход 1 — создать с pairedDoorId null + запомнить токены;
  // обход 2 — резолв токенов в IDs (ADR §D.2, точный алгоритм §D.5).
  const doors: GameplayDoor[] = cells.doors.map((d, i) => {
    const c = cellCenter(grid, d.x, d.y);
    const off = DOOR_EDGE_OFFSET[d.edge];
    return {
      id: legacyDoorId(i),
      kind: "door" as const,
      position: { x: c.cx + off.x, y: c.cy + off.y },
      orientation: DOOR_ORIENTATION[d.edge],
      doorKind: d.kind,
      secret: d.secret,
      pairedDoorId: null,
    };
  });
  const groups = new Map<string, number[]>();
  cells.doors.forEach((d, i) => {
    if (d.pair === null) return;
    const list = groups.get(d.pair) ?? [];
    list.push(i);
    groups.set(d.pair, list);
  });
  for (const [token, idxs] of groups) {
    const sorted = [...idxs].sort((a, b) => a - b);
    const doorIds = sorted.map((i) => doors[i].id);
    if (sorted.length === 1) {
      warnings.push({
        code: "dangling-pair-token",
        token,
        doorIds,
        message: `pair token "${token}": single door ${doorIds[0]} (partner deleted?), pairedDoorId left null`,
      });
    } else if (sorted.length === 2) {
      doors[sorted[0]].pairedDoorId = doors[sorted[1]].id;
      doors[sorted[1]].pairedDoorId = doors[sorted[0]].id;
    } else {
      for (let k = 0; k + 1 < sorted.length; k += 2) {
        doors[sorted[k]].pairedDoorId = doors[sorted[k + 1]].id;
        doors[sorted[k + 1]].pairedDoorId = doors[sorted[k]].id;
      }
      warnings.push({
        code: "oversized-pair-group",
        token,
        doorIds,
        message: `pair token "${token}": ${sorted.length} doors linked as consecutive pairs by legacy index order` +
          (sorted.length % 2 === 1 ? `, leftover ${doors[sorted[sorted.length - 1]].id} left null` : ""),
      });
    }
  }
  gameplay.push(...doors);

  cells.traps.forEach((t, i) => {
    gameplay.push({
      id: legacyTrapId(i),
      kind: "trap",
      position: cellPos(grid, t.x, t.y),
      trapKind: t.kind,
    });
  });
  cells.markers.forEach((m, i) => {
    gameplay.push({
      id: legacyMarkerId(i),
      kind: "marker",
      position: cellPos(grid, m.x, m.y),
      markerKind: m.kind,
    });
  });
  if (cells.start) {
    gameplay.push({ id: LEGACY_START_ID, kind: "start", position: cellPos(grid, cells.start.x, cells.start.y) });
  }
  if (cells.finish) {
    gameplay.push({ id: LEGACY_FINISH_ID, kind: "finish", position: cellPos(grid, cells.finish.x, cells.finish.y) });
  }

  // --- Сборка слоёв по скелету D.3 ---
  const byId: Record<string, MapLayer> = {
    [LEGACY_LAYER_SKELETON[0].id]: {
      ...LEGACY_LAYER_SKELETON[0],
      kind: "terrain",
      representation: "cells",
      defaultMaterial: BUILTIN_PLAIN_MATERIAL,
      cells: terrainCells,
    },
    [LEGACY_LAYER_SKELETON[1].id]: { ...LEGACY_LAYER_SKELETON[1], kind: "path", paths: riverPaths },
    [LEGACY_LAYER_SKELETON[2].id]: { ...LEGACY_LAYER_SKELETON[2], kind: "path", paths: roadPaths },
    [LEGACY_LAYER_SKELETON[3].id]: { ...LEGACY_LAYER_SKELETON[3], kind: "object", items: [] },
    [LEGACY_LAYER_SKELETON[4].id]: { ...LEGACY_LAYER_SKELETON[4], kind: "scatter", areas: [] },
    [LEGACY_LAYER_SKELETON[5].id]: { ...LEGACY_LAYER_SKELETON[5], kind: "gameplay", items: gameplay },
    [LEGACY_LAYER_SKELETON[6].id]: { ...LEGACY_LAYER_SKELETON[6], kind: "label", items: labels },
  };
  const layers: MapLayer[] = LEGACY_LAYER_SKELETON.map((s) => byId[s.id]);

  const document: MapDocumentV5 = {
    v: 5,
    world: { bounds: buildBounds(grid, width, height) },
    grid: buildGrid(grid, width, height),
    assetPacks: [],
    layers,
  };
  return { document, warnings };
}
