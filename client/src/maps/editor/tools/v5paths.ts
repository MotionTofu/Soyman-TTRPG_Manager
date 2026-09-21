// V5 path editing для инструментов (Фаза 2G): один editable cell-network
// path на kind (road/river). Совместимый документ гарантирует ≤1;
// 0 → создать новым ID от editor factory; >1 → structured action error,
// а не «первый попавшийся» (§33 ТЗ).

import { BUILTIN_RIVER_STYLE, BUILTIN_ROAD_STYLE } from "../../core/refs";
import {
  addPathCells,
  createCellNetworkPath,
  removePathCells,
} from "../../core/mutations/paths";
import { mutationError, type MutationResult } from "../../core/mutations/types";
import type { MapDocumentV5 } from "../../core/types";

export const ROAD_LAYER_ID = "lyr-road";
export const RIVER_LAYER_ID = "lyr-river";

interface EditablePath {
  layerId: string;
  pathId: string;
}

function editablePaths(doc: MapDocumentV5, kind: "road" | "river"): EditablePath[] {
  const out: EditablePath[] = [];
  for (const layer of doc.layers) {
    if (layer.kind !== "path") continue;
    for (const p of layer.paths) {
      if (p.kind === kind && p.geometry.type === "cell-network") {
        out.push({ layerId: layer.id, pathId: p.id });
      }
    }
  }
  return out;
}

function styleFor(kind: "road" | "river") {
  return kind === "road" ? BUILTIN_ROAD_STYLE : BUILTIN_RIVER_STYLE;
}

function layerFor(doc: MapDocumentV5, kind: "road" | "river"): string | null {
  const want = kind === "road" ? ROAD_LAYER_ID : RIVER_LAYER_ID;
  const exact = doc.layers.find((l) => l.id === want && l.kind === "path");
  if (exact) return exact.id;
  const any = doc.layers.find((l) => l.kind === "path");
  return any ? any.id : null;
}

/** Добавить клетки в editable path (создать при отсутствии). */
export function addCellsToEditablePath(
  doc: MapDocumentV5,
  kind: "road" | "river",
  cells: Array<{ x: number; y: number }>,
  newId: () => string,
): MutationResult {
  const found = editablePaths(doc, kind);
  if (found.length > 1) {
    return mutationError(
      "tool.path-ambiguous",
      "pathId",
      `несколько ${kind} paths: кисть не знает, какой редактировать`,
    );
  }
  if (found.length === 0) {
    if (cells.length === 0) {
      return { ok: true, changed: false, document: doc };
    }
    const layerId = layerFor(doc, kind);
    if (!layerId) {
      return mutationError("tool.no-path-layer", "layerId", "в документе нет path-слоя");
    }
    return createCellNetworkPath(doc, layerId, {
      id: newId(),
      kind,
      styleRef: styleFor(kind),
      width: 1,
      cells,
    });
  }
  return addPathCells(doc, found[0].pathId, cells);
}

/** Убрать клетки из editable path (нет path → no-op). */
export function removeCellsFromEditablePath(
  doc: MapDocumentV5,
  kind: "road" | "river",
  cells: Array<{ x: number; y: number }>,
): MutationResult {
  const found = editablePaths(doc, kind);
  if (found.length > 1) {
    return mutationError(
      "tool.path-ambiguous",
      "pathId",
      `несколько ${kind} paths: кисть не знает, какой редактировать`,
    );
  }
  if (found.length === 0) {
    return { ok: true, changed: false, document: doc };
  }
  return removePathCells(doc, found[0].pathId, cells);
}
