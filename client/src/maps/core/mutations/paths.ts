// cell-network path mutations: add/remove/replace/create по pathId.
// Spline — structured unsupported (без конвертации). Пустой cell-network
// invalid: удаление последней клетки удаляет path целиком.

import { isStyleRef } from "../refs";
import type { StyleRef } from "../refs";
import type {
  EntityId,
  MapDocumentV5,
  MapPath,
  PathLayer,
} from "../types";
import {
  changed,
  collectIds,
  findLayer,
  noChange,
  withReplacedLayer,
  mutationError,
  type MutationResult,
} from "./helpers";

export interface CellNetworkPathSpec {
  id: EntityId;
  kind: string;
  styleRef: StyleRef;
  width: number;
  cells: Array<{ x: number; y: number }>;
}

interface ResolvedPath {
  layerIndex: number;
  layer: PathLayer;
  pathIndex: number;
  path: MapPath;
}

function resolvePath(doc: MapDocumentV5, pathId: string): ResolvedPath | { error: MutationResult } {
  for (let li = 0; li < doc.layers.length; li++) {
    const layer = doc.layers[li];
    if (layer.kind !== "path") continue;
    const pi = layer.paths.findIndex((p) => p.id === pathId);
    if (pi !== -1) return { layerIndex: li, layer, pathIndex: pi, path: layer.paths[pi] };
  }
  return {
    error: mutationError("path.unknown-id", "pathId", `path "${pathId}" does not exist`),
  };
}

function checkCells(
  doc: MapDocumentV5,
  cells: Array<{ x: number; y: number }>,
  path: string,
): MutationResult | null {
  const grid = doc.grid;
  if (!grid) {
    return mutationError("path.cell-network.no-grid", "grid", "cell-network requires document.grid");
  }
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) {
      return mutationError("path.bad-cell", `${path}[${i}]`, "cell x/y must be integers");
    }
    if (c.x < 0 || c.y < 0 || c.x >= grid.columns || c.y >= grid.rows) {
      return mutationError(
        "path.cell-out-of-grid",
        `${path}[${i}]`,
        `cell (${c.x},${c.y}) outside ${grid.columns}x${grid.rows}`,
      );
    }
  }
  return null;
}

function sortCells(cells: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}

function withPaths(doc: MapDocumentV5, layerIndex: number, layer: PathLayer, paths: MapPath[]): MutationResult {
  return changed(withReplacedLayer(doc, layerIndex, { ...layer, paths }));
}

function requireCellNetwork(path: MapPath): MutationResult | null {
  if (path.geometry.type !== "cell-network") {
    return mutationError(
      "path.unsupported-spline",
      "pathId",
      `path "${path.id}" is spline (read-only on this phase)`,
    );
  }
  return null;
}

/** Добавить клетки в cell-network (batch; дубликаты = no-op). Атомарно. */
export function addPathCells(
  doc: MapDocumentV5,
  pathId: string,
  cells: Array<{ x: number; y: number }>,
): MutationResult {
  const resolved = resolvePath(doc, pathId);
  if ("error" in resolved) return resolved.error;
  const badGeometry = requireCellNetwork(resolved.path);
  if (badGeometry) return badGeometry;
  const bad = checkCells(doc, cells, "cells");
  if (bad) return bad;

  const have = new Set(
    (resolved.path.geometry.type === "cell-network" ? resolved.path.geometry.cells : []).map(
      (c) => `${c.x},${c.y}`,
    ),
  );
  let touched = false;
  for (const c of cells) {
    const key = `${c.x},${c.y}`;
    if (!have.has(key)) {
      have.add(key);
      touched = true;
    }
  }
  if (!touched) return noChange(doc);
  const merged = sortCells([...have].map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  }));
  const paths = [...resolved.layer.paths];
  paths[resolved.pathIndex] = {
    ...resolved.path,
    geometry: { type: "cell-network", cells: merged },
  };
  return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
}

/** Убрать клетки; удаление последней удаляет path целиком. */
export function removePathCells(
  doc: MapDocumentV5,
  pathId: string,
  cells: Array<{ x: number; y: number }>,
): MutationResult {
  const resolved = resolvePath(doc, pathId);
  if ("error" in resolved) return resolved.error;
  const badGeometry = requireCellNetwork(resolved.path);
  if (badGeometry) return badGeometry;

  const drop = new Set(cells.map((c) => `${c.x},${c.y}`));
  const geometry = resolved.path.geometry;
  if (geometry.type !== "cell-network") {
    // Недостижимо (проверено выше), но сохраняет типовую безопасность без кастов.
    return mutationError("path.unsupported-spline", "pathId", `path "${pathId}" is spline`);
  }
  const kept = geometry.cells.filter((c) => !drop.has(`${c.x},${c.y}`));
  if (kept.length === geometry.cells.length) return noChange(doc);
  if (kept.length === 0) {
    const paths = resolved.layer.paths.filter((_, i) => i !== resolved.pathIndex);
    return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
  }
  const paths = [...resolved.layer.paths];
  paths[resolved.pathIndex] = {
    ...resolved.path,
    geometry: { type: "cell-network", cells: sortCells(kept) },
  };
  return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
}

/** Заменить множество клеток целиком (пустое = удалить path). */
export function replacePathCells(
  doc: MapDocumentV5,
  pathId: string,
  cells: Array<{ x: number; y: number }>,
): MutationResult {
  const resolved = resolvePath(doc, pathId);
  if ("error" in resolved) return resolved.error;
  const badGeometry = requireCellNetwork(resolved.path);
  if (badGeometry) return badGeometry;
  const bad = checkCells(doc, cells, "cells");
  if (bad) return bad;

  const seen = new Set<string>();
  for (const c of cells) seen.add(`${c.x},${c.y}`);
  if (seen.size === 0) {
    const paths = resolved.layer.paths.filter((_, i) => i !== resolved.pathIndex);
    return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
  }
  const geometry = resolved.path.geometry;
  if (geometry.type !== "cell-network") {
    return mutationError("path.unsupported-spline", "pathId", `path "${pathId}" is spline`);
  }
  const current = new Set(geometry.cells.map((c) => `${c.x},${c.y}`));
  if (current.size === seen.size && [...seen].every((k) => current.has(k))) {
    return noChange(doc);
  }
  const paths = [...resolved.layer.paths];
  paths[resolved.pathIndex] = {
    ...resolved.path,
    geometry: { type: "cell-network", cells: sortCells([...seen].map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    })) },
  };
  return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
}

/** Создать cell-network path. ID приходит извне (без random). */
export function createCellNetworkPath(
  doc: MapDocumentV5,
  layerId: string,
  spec: CellNetworkPathSpec,
): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found) {
    return mutationError("path.unknown-layer", "layerId", `layer "${layerId}" does not exist`);
  }
  if (found.layer.kind !== "path") {
    return mutationError(
      "path.wrong-layer-kind",
      "layerId",
      `layer "${layerId}" is ${found.layer.kind}, not path`,
    );
  }
  if (typeof spec.id !== "string" || spec.id.length === 0) {
    return mutationError("path.bad-id", "spec.id", "path id must be a non-empty string");
  }
  if (collectIds(doc).has(spec.id)) {
    return mutationError("path.duplicate-id", "spec.id", `id "${spec.id}" already exists in document`);
  }
  if (typeof spec.kind !== "string" || spec.kind.length === 0) {
    return mutationError("path.bad-kind", "spec.kind", "path kind must be a non-empty string");
  }
  if (!isStyleRef(spec.styleRef)) {
    return mutationError("path.bad-style-ref", "spec.styleRef", "expected builtin | asset style ref");
  }
  if (typeof spec.width !== "number" || !Number.isFinite(spec.width) || spec.width <= 0) {
    return mutationError("path.bad-width", "spec.width", "width must be > 0");
  }
  if (!Array.isArray(spec.cells) || spec.cells.length === 0) {
    return mutationError("path.empty-cells", "spec.cells", "cell-network needs >= 1 cell (empty is invalid)");
  }
  const bad = checkCells(doc, spec.cells, "spec.cells");
  if (bad) return bad;
  const seen = new Set(spec.cells.map((c) => `${c.x},${c.y}`));

  const path: MapPath = {
    id: spec.id,
    kind: spec.kind,
    geometry: {
      type: "cell-network",
      cells: sortCells([...seen].map((key) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y };
      })),
    },
    width: spec.width,
    styleRef: spec.styleRef,
  };
  const paths = [...found.layer.paths, path];
  const result = withPaths(doc, found.index, found.layer, paths);
  if (result.ok) return { ...result, entityId: spec.id };
  return result;
}
