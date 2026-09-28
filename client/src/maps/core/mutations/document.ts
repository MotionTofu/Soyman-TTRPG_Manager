// Whole-document V5 transforms: clear + resize (Фаза 2G, §61–63).
// Clear сохраняет world/grid/skeleton, вычищая editable content.
// Resize воспроизводит legacy crop semantics 1:1 (settings-модалка):
// в-поле остаётся, снаружи падает; комната торчит — целиком; пути пустеют
// и удаляются. Без угадывания (§64 ТЗ): правила — те же проверки bounds,
// что делал старый editor, применённые к cell-space данным.

import { cellCorners, pixelToCell } from "../../grid";
import { MAP_MAX_SIDE, MAP_MIN_SIDE } from "../../mapTypes";
import type {
  GameplayEntity,
  MapDocumentV5,
  MapLayer,
  ShapeGeometry,
} from "../types";
import {
  changed,
  noChange,
  mutationError,
  type MutationResult,
} from "./helpers";

function emptyLayer(layer: MapLayer): { layer: MapLayer; touched: boolean } {
  if (layer.kind === "terrain") {
    if (layer.representation === "mask") return { layer, touched: false };
    if (layer.cells.length === 0) return { layer, touched: false };
    return { layer: { ...layer, cells: [] }, touched: true };
  }
  if (layer.kind === "path") {
    if (layer.paths.length === 0) return { layer, touched: false };
    return { layer: { ...layer, paths: [] }, touched: true };
  }
  if (layer.kind === "object") {
    if (layer.items.length === 0) return { layer, touched: false };
    return { layer: { ...layer, items: [] }, touched: true };
  }
  if (layer.kind === "scatter") {
    if (layer.areas.length === 0) return { layer, touched: false };
    return { layer: { ...layer, areas: [] }, touched: true };
  }
  if (layer.kind === "label") {
    if (layer.items.length === 0) return { layer, touched: false };
    return { layer: { ...layer, items: [] }, touched: true };
  }
  if (layer.kind === "gameplay") {
    if (layer.items.length === 0) return { layer, touched: false };
    return { layer: { ...layer, items: [] }, touched: true };
  }
  return { layer, touched: false };
}

/**
 * Очистить editable content (Clear): мир/сетка/скелет слоёв целы.
 * Пустая карта → no-op с тем же reference.
 */
export function clearEditableContent(doc: MapDocumentV5): MutationResult {
  let touched = false;
  const layers = doc.layers.map((l) => {
    const r = emptyLayer(l);
    if (r.touched) touched = true;
    return r.layer;
  });
  if (doc.exploration !== undefined) touched = true;
  if (!touched) return noChange(doc);
  return changed({ ...doc, layers, exploration: undefined });
}

function shapeFitsGrid(shape: ShapeGeometry, width: number, height: number): boolean {
  if (shape.type === "rect") {
    return (
      Number.isInteger(shape.x) &&
      Number.isInteger(shape.y) &&
      shape.x >= 0 &&
      shape.y >= 0 &&
      shape.x + shape.w <= width &&
      shape.y + shape.h <= height
    );
  }
  // Polygon/ellipse: bbox-фит тем же правилом «торчит — целиком».
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const pts =
    shape.type === "polygon"
      ? shape.points
      : [
          { x: shape.center.x - shape.rx, y: shape.center.y - shape.ry },
          { x: shape.center.x + shape.rx, y: shape.center.y + shape.ry },
        ];
  if (pts.length === 0) return false;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return minX >= 0 && minY >= 0 && maxX <= width && maxY <= height;
}

/**
 * Resize документа: grid columns/rows + пересчёт bounds, crop OOB данных
 * по legacy-правилам. Атомарно; ошибка → issues, вход цел.
 */
export function resizeGridDocument(doc: MapDocumentV5, width: number, height: number): MutationResult {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return mutationError("resize.bad-dims", "size", "width/height must be integers");
  }
  if (width < MAP_MIN_SIDE || width > MAP_MAX_SIDE || height < MAP_MIN_SIDE || height > MAP_MAX_SIDE) {
    return mutationError(
      "resize.out-of-range",
      "size",
      `width/height must be ${MAP_MIN_SIDE}..${MAP_MAX_SIDE}`,
    );
  }
  if (doc.grid === null) {
    return mutationError("resize.no-grid", "grid", "resize requires document.grid");
  }
  const grid = doc.grid;
  if (grid.columns === width && grid.rows === height) return noChange(doc);

  const inNew = (x: number, y: number): boolean =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  // Мировая позиция → содержащая клетка СТАРОЙ сетки (для migrated-карт точно,
  // для free-позиций — правило containing-cell, как px→cell у редактора).
  const containingCell = (px: number, py: number): { x: number; y: number } | null => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    const c = pixelToCell(grid.type, px, py, grid.columns, grid.rows);
    return c;
  };
  const pointFits = (px: number, py: number): boolean => {
    const c = containingCell(px, py);
    return c !== null && c.x < width && c.y < height;
  };

  let touched = false;
  const layers: MapLayer[] = doc.layers.map((layer) => {
    if (layer.kind === "terrain") {
      if (layer.representation !== "cells") return layer;
      const cells = layer.cells.filter((c) => inNew(c.x, c.y));
      if (cells.length === layer.cells.length) return layer;
      touched = true;
      return { ...layer, cells };
    }
    if (layer.kind === "path") {
      const paths = [];
      for (const p of layer.paths) {
        if (p.geometry.type !== "cell-network") {
          paths.push(p);
          continue;
        }
        const keptCells = p.geometry.cells.filter((c) => inNew(c.x, c.y));
        if (keptCells.length === 0) {
          touched = true;
          continue;
        }
        if (keptCells.length !== p.geometry.cells.length) touched = true;
        paths.push(
          keptCells.length === p.geometry.cells.length
            ? p
            : { ...p, geometry: { type: "cell-network" as const, cells: keptCells } },
        );
      }
      if (paths.length === layer.paths.length && !touched) return layer;
      return { ...layer, paths };
    }
    if (layer.kind === "label") {
      const items = layer.items.filter((l) => pointFits(l.position.x, l.position.y));
      if (items.length === layer.items.length) return layer;
      touched = true;
      return { ...layer, items };
    }
    if (layer.kind === "object") {
      const items = layer.items.filter((object) => pointFits(object.transform.position.x, object.transform.position.y));
      if (items.length === layer.items.length) return layer;
      touched = true;
      return { ...layer, items };
    }
    if (layer.kind === "gameplay") {
      const items: GameplayEntity[] = [];
      for (const e of layer.items) {
        if (e.kind === "room") {
          if (shapeFitsGrid(e.geometry, width, height)) items.push(e);
          else touched = true;
          continue;
        }
        if (pointFits(e.position.x, e.position.y)) items.push(e);
        else touched = true;
      }
      if (!touched) return layer;
      return { ...layer, items };
    }
    return layer;
  });

  const newGrid = { ...grid, columns: width, rows: height };
  const exploration = doc.exploration === undefined ? undefined : {
    ...doc.exploration,
    revealedCells: doc.exploration.revealedCells.filter((cell) => inNew(cell.x, cell.y)),
  };
  const world =
    grid.type === "square"
      ? { bounds: { minX: 0, minY: 0, maxX: width, maxY: height } }
      : hexBounds(width, height);
  return changed({ ...doc, grid: newGrid, world, layers, exploration });
}

function hexBounds(width: number, height: number): MapDocumentV5["world"] {
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
  return { bounds: { minX, minY, maxX, maxY } };
}
