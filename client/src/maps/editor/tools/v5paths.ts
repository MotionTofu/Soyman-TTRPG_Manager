// V5 path editing для инструментов (Фаза 3A, §38–40): кисть работает ВНУТРИ
// target PathLayer. Ambiguity проверяется внутри слоя: 0 → создать новым ID
// от editor factory; 1 → редактировать; >1 → structured action error.
// Наличие road paths в ДРУГИХ слоях больше не ошибка.

import { BUILTIN_RIVER_STYLE, BUILTIN_ROAD_STYLE } from "../../core/refs";
import {
  addPathCells,
  createCellNetworkPath,
  removePathCells,
} from "../../core/mutations/paths";
import { mutationError, type MutationResult } from "../../core/mutations/types";
import type { MapDocumentV5 } from "../../core/types";

function editablePathsInLayer(
  doc: MapDocumentV5,
  layerId: string,
  kind: "road" | "river",
): string[] {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "path") return [];
  const out: string[] = [];
  for (const p of layer.paths) {
    if (p.kind === kind && p.geometry.type === "cell-network") {
      out.push(p.id);
    }
  }
  return out;
}

function styleFor(kind: "road" | "river") {
  return kind === "road" ? BUILTIN_ROAD_STYLE : BUILTIN_RIVER_STYLE;
}

/** Добавить клетки в editable path target слоя (создать при отсутствии). */
export function addCellsToLayerPath(
  doc: MapDocumentV5,
  layerId: string,
  kind: "road" | "river",
  cells: Array<{ x: number; y: number }>,
  newId: () => string,
): MutationResult {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "path") {
    return mutationError("tool.no-path-layer", "layerId", "целевой path-слой не найден");
  }
  if (layer.locked) {
    return mutationError("tool.layer-locked", "layerId", "слой заблокирован");
  }
  const found = editablePathsInLayer(doc, layerId, kind);
  if (found.length > 1) {
    return mutationError(
      "tool.path-ambiguous",
      "pathId",
      `в слое несколько ${kind} paths: кисть не знает, какой редактировать`,
    );
  }
  if (found.length === 0) {
    if (cells.length === 0) {
      return { ok: true, changed: false, document: doc };
    }
    return createCellNetworkPath(doc, layerId, {
      id: newId(),
      kind,
      styleRef: styleFor(kind),
      width: 1,
      cells,
    });
  }
  return addPathCells(doc, found[0], cells);
}

/** Убрать клетки из editable path target слоя (нет path → no-op). */
export function removeCellsFromLayerPath(
  doc: MapDocumentV5,
  layerId: string,
  kind: "road" | "river",
  cells: Array<{ x: number; y: number }>,
): MutationResult {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "path") {
    return mutationError("tool.no-path-layer", "layerId", "целевой path-слой не найден");
  }
  if (layer.locked) {
    return mutationError("tool.layer-locked", "layerId", "слой заблокирован");
  }
  const found = editablePathsInLayer(doc, layerId, kind);
  if (found.length > 1) {
    return mutationError(
      "tool.path-ambiguous",
      "pathId",
      `в слое несколько ${kind} paths: кисть не знает, какой редактировать`,
    );
  }
  if (found.length === 0) {
    return { ok: true, changed: false, document: doc };
  }
  return removePathCells(doc, found[0], cells);
}
