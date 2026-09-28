import type { MapDocumentV5 } from "../types";
import { changed, mutationError, noChange, type MutationResult } from "./helpers";

/** Маска отсутствует на старых картах: они полностью открыты игроку. */
export function setExplorationEnabled(doc: MapDocumentV5, enabled: boolean): MutationResult {
  if (!doc.grid) return mutationError("exploration.no-grid", "grid", "Для раскрытия нужна сетка.");
  if (doc.exploration?.enabled === enabled) return noChange(doc);
  return changed({ ...doc, exploration: {
    enabled,
    revealedCells: doc.exploration?.revealedCells ?? [],
  } });
}

export function paintExplorationCell(doc: MapDocumentV5, x: number, y: number, reveal: boolean): MutationResult {
  const grid = doc.grid;
  if (!grid || !doc.exploration?.enabled) return noChange(doc);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= grid.columns || y >= grid.rows) {
    return mutationError("exploration.out-of-bounds", "cell", "Клетка вне карты.");
  }
  const cells = doc.exploration.revealedCells;
  const index = cells.findIndex((cell) => cell.x === x && cell.y === y);
  if (reveal ? index >= 0 : index < 0) return noChange(doc);
  const revealedCells = reveal ? [...cells, { x, y }] : cells.filter((_, i) => i !== index);
  return changed({ ...doc, exploration: { enabled: true, revealedCells } });
}

export function setAllExplorationCells(doc: MapDocumentV5, reveal: boolean): MutationResult {
  const grid = doc.grid;
  if (!grid || !doc.exploration?.enabled) return noChange(doc);
  const count = grid.columns * grid.rows;
  if (reveal && doc.exploration.revealedCells.length === count) return noChange(doc);
  if (!reveal && doc.exploration.revealedCells.length === 0) return noChange(doc);
  const revealedCells: Array<{ x: number; y: number }> = [];
  if (reveal) for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.columns; x++) revealedCells.push({ x, y });
  return changed({ ...doc, exploration: { enabled: true, revealedCells } });
}
