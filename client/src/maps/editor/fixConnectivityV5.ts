// Ручная починка связности на V5 (Фаза 2G): тот же алгоритм, что legacy
// fixMapConnectivity (рабочая сетка wall→стена/остальное→пол, L-коридоры
// к изолированным комнатам), но читает V5 terrain/rooms/start напрямую.
// Возвращает клетки для erase-batch (material → default) + число починок.
// Без комнат (rect) — null. Чистый модуль без React.

import { dungeonReachable } from "../dungeon";
import { cellKey, pixelToCell } from "../grid";
import type { MapDocumentV5 } from "../core/types";

interface BuiltRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fixDungeonConnectivity(
  grid: number[][],
  rooms: BuiltRoom[],
  start: { x: number; y: number } | null
): void {
  const height = grid.length;
  const width = height > 0 ? grid[0].length : 0;
  const inB = (y: number, x: number) => y >= 0 && x >= 0 && y < height && x < width;
  let reach = dungeonReachable(grid, start);
  const isolated = rooms.filter((rm) => {
    for (let rr = rm.y; rr < rm.y + rm.h; rr++)
      for (let cc = rm.x; cc < rm.x + rm.w; cc++) if (reach.has(cellKey(cc, rr))) return false;
    return true;
  });
  if (isolated.length === 0) return;
  for (const rm of isolated) {
    let best: BuiltRoom | null = null;
    let bestD = Infinity;
    for (const o of rooms) {
      if (o === rm) continue;
      let linked = false;
      for (let rr = o.y; rr < o.y + o.h && !linked; rr++)
        for (let cc = o.x; cc < o.x + o.w && !linked; cc++) if (reach.has(cellKey(cc, rr))) linked = true;
      if (!linked) continue;
      const d = Math.abs(rm.x + rm.w / 2 - (o.x + o.w / 2)) + Math.abs(rm.y + rm.h / 2 - (o.y + o.h / 2));
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) continue;
    // L-коридор по прямой между центрами (только целина → пол).
    const x0 = Math.floor(rm.x + rm.w / 2);
    const y0 = Math.floor(rm.y + rm.h / 2);
    const x1 = Math.floor(best.x + best.w / 2);
    const y1 = Math.floor(best.y + best.h / 2);
    for (let c = Math.min(x0, x1); c <= Math.max(x0, x1); c++)
      if (inB(y0, c) && grid[y0][c] === 0) grid[y0][c] = 2;
    for (let r = Math.min(y0, y1); r <= Math.max(y0, y1); r++)
      if (inB(r, x1) && grid[r][x1] === 0) grid[r][x1] = 2;
    reach = dungeonReachable(grid, start);
  }
}

export interface ConnectivityFix {
  cleared: Array<{ x: number; y: number }>;
  fixed: number;
}

/** Починить связность V5-документа. Null — чинить нечего/не на чем.
 *  3A §101–102: terrain берётся из явно переданного слоя (active/target);
 *  без него — первый клеточный (legacy-поведение для одиночных карт).
 *  Комнаты/старт сканируются по всем gameplay-слоям: связность — свойство карты. */
export function fixConnectivityV5(doc: MapDocumentV5, terrainLayerId?: string): ConnectivityFix | null {
  const grid = doc.grid;
  if (!grid) return null;
  const width = grid.columns;
  const height = grid.rows;

  const terrain = terrainLayerId
    ? doc.layers.find((l) => l.id === terrainLayerId)
    : doc.layers.find((l) => l.kind === "terrain");
  const entries = new Map<string, { type: string; key?: string; assetId?: string }>();
  if (terrain && terrain.kind === "terrain" && terrain.representation === "cells") {
    for (const c of terrain.cells) entries.set(`${c.x},${c.y}`, c.material);
  }
  const def = terrain && terrain.kind === "terrain" ? terrain.defaultMaterial : null;
  const isWall = (x: number, y: number): boolean => {
    const m = entries.get(`${x},${y}`) ?? def;
    return !!m && m.type === "builtin" && (m as { key: string }).key === "terrain/wall";
  };

  const rooms: BuiltRoom[] = [];
  let start: { x: number; y: number } | null = null;
  for (const layer of doc.layers) {
    if (layer.kind !== "gameplay") continue;
    for (const e of layer.items) {
      if (e.kind === "room" && e.geometry.type === "rect") {
        rooms.push({ x: e.geometry.x, y: e.geometry.y, w: e.geometry.w, h: e.geometry.h });
      } else if (e.kind === "start") {
        const c = pixelToCell(grid.type, e.position.x, e.position.y, width, height);
        start = c ? { x: c.x, y: c.y } : null;
      }
    }
  }
  if (rooms.length === 0) return null;

  const work: number[][] = Array.from({ length: height }, () => Array(width).fill(0));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) work[y][x] = isWall(x, y) ? 0 : 1;

  const reach0 = dungeonReachable(work, start);
  const isolatedCount = rooms.filter((rm) => {
    for (let rr = rm.y; rr < rm.y + rm.h; rr++)
      for (let cc = rm.x; cc < rm.x + rm.w; cc++) if (reach0.has(cellKey(cc, rr))) return false;
    return true;
  }).length;
  if (isolatedCount === 0) return { cleared: [], fixed: 0 };
  fixDungeonConnectivity(work, rooms, start);

  const cleared: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (work[y][x] !== 0 && isWall(x, y)) cleared.push({ x, y });
    }
  const reach1 = dungeonReachable(work, start);
  const still = rooms.filter((rm) => {
    for (let rr = rm.y; rr < rm.y + rm.h; rr++)
      for (let cc = rm.x; cc < rm.x + rm.w; cc++) if (reach1.has(cellKey(cc, rr))) return false;
    return true;
  }).length;
  return { cleared, fixed: isolatedCount - still };
}
