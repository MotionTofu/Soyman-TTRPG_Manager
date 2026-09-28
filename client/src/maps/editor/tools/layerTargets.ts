// Tool → layer target resolver (Фаза 3A, §32–35).
// Единственное место, решающее «в какой слой пишет инструмент»:
// не размазывать find layer по tool modules. Pure, без React.
//
// Правила (§34):
// - active layer совместимого kind + visible + unlocked → использовать его;
// - иначе topmost visible unlocked compatible → использовать и вернуть как
//   новый active (caller переключает);
// - нет подходящего → structured error, НЕ создавать магически.
// Topmost — ожидаемая compositing semantics (§35); explicit active — приоритет (§93).

import type { LayerId, MapDocumentV5, MapLayer } from "../../core/types";
import type { PaintTool } from "../editorTypes";

export type ToolLayerKind = "terrain" | "path" | "gameplay" | "label" | "object";

export const NO_COMPATIBLE_LAYER_ERROR = "Нет доступного слоя подходящего типа.";

/** Какой kind слоя нужен инструменту; null — layer-neutral (ruler/select/shape-контейнер). */
export function toolLayerKind(tool: PaintTool): ToolLayerKind | null {
  switch (tool) {
    case "brush":
    case "fill":
    case "eraser":
    case "picker":
    case "wall":
      return "terrain";
    case "road":
    case "river":
      return "path";
    case "door":
    case "trap":
    case "chest":
    case "altar":
    case "marker":
    case "start":
    case "finish":
      return "gameplay";
    case "label":
      return "label";
    case "asset":
      return "object";
    default:
      return null;
  }
}

/** Совместим ли слой как target для kind (без visible/lock — они отдельно). */
export function isCompatibleTarget(layer: MapLayer, want: ToolLayerKind): boolean {
  if (layer.kind !== want) return false;
  // Кисти работают кодами клеток; mask-terrain brush не красит.
  if (want === "terrain" && layer.kind === "terrain") {
    return layer.representation === "cells";
  }
  return true;
}

export type ToolTargetResult =
  | { ok: true; layerId: LayerId; keptActive: boolean }
  | { ok: false; error: string };

/**
 * Резолв target слоя для kind.
 * keptActive=true — active остался (был valid); false — caller должен сделать
 * возвращённый layerId новым activeLayerId.
 */
export function resolveToolTargetLayer(
  doc: MapDocumentV5,
  activeLayerId: LayerId | null,
  want: ToolLayerKind,
): ToolTargetResult {
  if (activeLayerId !== null) {
    const active = doc.layers.find((l) => l.id === activeLayerId);
    if (
      active &&
      isCompatibleTarget(active, want) &&
      active.visible &&
      !active.locked
    ) {
      return { ok: true, layerId: active.id, keptActive: true };
    }
  }
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!isCompatibleTarget(l, want)) continue;
    if (!l.visible || l.locked) continue;
    return { ok: true, layerId: l.id, keptActive: false };
  }
  return { ok: false, error: NO_COMPATIBLE_LAYER_ERROR };
}
