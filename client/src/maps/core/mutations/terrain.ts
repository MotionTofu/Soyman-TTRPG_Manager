// TerrainCellLayer mutations: read + batch edits + flood fill.
// Только cells-представление (mask — read/validation-only: structured
// unsupported issue, без конвертации). Grid — из документа.

import { neighbors } from "../../grid";
import type { MaterialRef } from "../refs";
import type { MapDocumentV5, TerrainCellEntry, TerrainCellLayer } from "../types";
import {
  changed,
  findLayer,
  noChange,
  withReplacedLayer,
  mutationError,
  type MutationResult,
} from "./helpers";

export interface TerrainCellEdit {
  x: number;
  y: number;
  /** Материал или null = стереть override (вернуться к default). */
  material: MaterialRef | null;
}

export type TerrainReadResult =
  | { ok: true; material: MaterialRef }
  | { ok: false; issues: { code: string; path: string; message: string }[] };

function materialEqual(a: MaterialRef, b: MaterialRef): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "builtin" && b.type === "builtin") return a.key === b.key;
  if (a.type === "asset" && b.type === "asset") return a.assetId === b.assetId;
  return false;
}

function resolveCellLayer(
  doc: MapDocumentV5,
  layerId: string,
): { index: number; layer: TerrainCellLayer } | { error: MutationResult } {
  const found = findLayer(doc, layerId);
  if (!found) {
    return {
      error: mutationError("terrain.unknown-layer", "layerId", `layer "${layerId}" does not exist`),
    };
  }
  const { index, layer } = found;
  if (layer.kind !== "terrain") {
    return {
      error: mutationError("terrain.wrong-layer-kind", "layerId", `layer "${layerId}" is ${layer.kind}, not terrain`),
    };
  }
  if (layer.representation !== "cells") {
    return {
      error: mutationError(
        "terrain.unsupported-mask",
        "layerId",
        `layer "${layerId}" is mask terrain (read/validation-only on this phase)`,
      ),
    };
  }
  if (doc.grid === null) {
    return {
      error: mutationError("terrain.no-grid", "grid", "cell terrain requires document.grid"),
    };
  }
  return { index, layer };
}

function checkCell(
  doc: MapDocumentV5,
  x: number,
  y: number,
  path: string,
): MutationResult | null {
  const grid = doc.grid;
  if (!grid) return mutationError("terrain.no-grid", "grid", "cell terrain requires document.grid");
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return mutationError("terrain.bad-cell", path, "cell x/y must be integers");
  }
  if (x < 0 || y < 0 || x >= grid.columns || y >= grid.rows) {
    return mutationError(
      "terrain.cell-out-of-grid",
      path,
      `cell (${x},${y}) outside ${grid.columns}x${grid.rows}`,
    );
  }
  return null;
}

/** Эффективный материал клетки (entry или default). */
export function readTerrainMaterialAt(
  doc: MapDocumentV5,
  layerId: string,
  x: number,
  y: number,
): TerrainReadResult {
  const resolved = resolveCellLayer(doc, layerId);
  if ("error" in resolved) {
    const r = resolved.error;
    return { ok: false, issues: !r.ok ? r.issues : [] };
  }
  const bad = checkCell(doc, x, y, "cell");
  if (bad) {
    return { ok: false, issues: !bad.ok ? bad.issues : [] };
  }
  const entry = resolved.layer.cells.find((c) => c.x === x && c.y === y);
  return { ok: true, material: entry ? entry.material : resolved.layer.defaultMaterial };
}

/**
 * Batch terrain edits (основная операция painting). Атомарно: любая
 * невалидная клетка фейлит всю операцию. Canonical: сортировка (y,x),
 * покраска в default удаляет override. No-op → тот же reference.
 */
export function applyTerrainCellEdits(
  doc: MapDocumentV5,
  layerId: string,
  edits: TerrainCellEdit[],
): MutationResult {
  const resolved = resolveCellLayer(doc, layerId);
  if ("error" in resolved) return resolved.error;
  const { index, layer } = resolved;

  for (let i = 0; i < edits.length; i++) {
    const bad = checkCell(doc, edits[i].x, edits[i].y, `edits[${i}]`);
    if (bad) return bad;
  }

  // Детерминизм при duplicate-координатах в одном batch: побеждает последняя
  // запись (как последовательное применение), порядок edits фиксирован.
  const byKey = new Map<string, TerrainCellEdit>();
  for (const e of edits) byKey.set(`${e.x},${e.y}`, e);

  const next = new Map<string, MaterialRef>();
  for (const c of layer.cells) next.set(`${c.x},${c.y}`, c.material);
  let touched = false;
  // Итерация в порядке edits (детерминирована входом), не Map-порядка.
  for (const e of byKey.values()) {
    const key = `${e.x},${e.y}`;
    const current = next.get(key);
    const target = e.material === null || materialEqual(e.material, layer.defaultMaterial) ? undefined : e.material;
    if (target === undefined) {
      if (current !== undefined) {
        next.delete(key);
        touched = true;
      }
      continue;
    }
    if (current === undefined || !materialEqual(current, target)) {
      next.set(key, target);
      touched = true;
    }
  }
  if (!touched) return noChange(doc);

  const cells: TerrainCellEntry[] = [...next.entries()].map(([key, material]) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y, material };
  });
  cells.sort((a, b) => a.y - b.y || a.x - b.x);
  return changed(withReplacedLayer(doc, index, { ...layer, cells }));
}

/**
 * Pure flood fill: starting material → contiguous region → replacement.
 * Соседство — существующий grid helper (square/hex как в editor).
 * Замена в default удаляет overrides; замена тем же — no-op.
 */
export function floodTerrainFill(
  doc: MapDocumentV5,
  layerId: string,
  startX: number,
  startY: number,
  replacement: MaterialRef,
): MutationResult {
  const resolved = resolveCellLayer(doc, layerId);
  if ("error" in resolved) return resolved.error;
  const bad = checkCell(doc, startX, startY, "start");
  if (bad) return bad;

  const grid = doc.grid;
  if (!grid) return mutationError("terrain.no-grid", "grid", "cell terrain requires document.grid");
  const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < grid.columns && y < grid.rows;
  const type = grid.type === "hex" ? "hex" : "square";

  const effective = new Map<string, MaterialRef>();
  for (const c of resolved.layer.cells) effective.set(`${c.x},${c.y}`, c.material);
  const at = (x: number, y: number): MaterialRef =>
    effective.get(`${x},${y}`) ?? resolved.layer.defaultMaterial;

  const startMaterial = at(startX, startY);
  if (materialEqual(startMaterial, replacement)) return noChange(doc);

  const region: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>([`${startX},${startY}`]);
  const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  while (queue.length > 0) {
    const cur = queue.pop() as { x: number; y: number };
    region.push(cur);
    for (const n of neighbors(type, cur.x, cur.y)) {
      if (!inGrid(n.x, n.y)) continue;
      const key = `${n.x},${n.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (materialEqual(at(n.x, n.y), startMaterial)) queue.push({ x: n.x, y: n.y });
    }
  }
  return applyTerrainCellEdits(
    doc,
    layerId,
    region.map(({ x, y }) => ({ x, y, material: replacement })),
  );
}
