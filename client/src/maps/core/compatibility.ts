// Current editor compatibility profile (Фаза 2G, §4–6).
// Отличается от validateMapDocument: валидный V5 может быть не по зубам
// текущему редактору (mask/spline/objects/scatter, несколько road paths,
// неквадратные комнаты...). Такое нельзя молча открыть на редактирование:
// renderer бы скрыл данные, а autosave — перезаписал (§7 ТЗ).
// Использует diagnostics createV5RenderModel как часть проверки.

import { MAP_MAX_SIDE, MAP_MIN_SIDE } from "../mapTypes";
import { createV5RenderModel } from "../renderModel";
import type { MapDocumentV5 } from "./types";

export interface CompatibilityIssue {
  code: string;
  message: string;
}

export interface EditorCompatibility {
  compatible: boolean;
  reasons: CompatibilityIssue[];
}

/**
 * Умеет ли текущий редактор безопасно редактировать весь документ.
 * Pure, без React. Не заменяет validateMapDocument.
 */
export function assessCurrentEditorCompatibility(doc: MapDocumentV5): EditorCompatibility {
  const reasons: CompatibilityIssue[] = [];
  const issue = (code: string, message: string) => reasons.push({ code, message });

  // Grid: редактор работает только с square|hex в пределах persistence-схемы.
  if (doc.grid === null) {
    issue("grid-missing", "editor requires a grid (gridless documents unsupported)");
  } else {
    if (doc.grid.type !== "square" && doc.grid.type !== "hex") {
      issue("grid-type", `editor supports square|hex, got ${doc.grid.type}`);
    }
    if (
      !Number.isInteger(doc.grid.columns) ||
      !Number.isInteger(doc.grid.rows) ||
      doc.grid.columns < MAP_MIN_SIDE ||
      doc.grid.columns > MAP_MAX_SIDE ||
      doc.grid.rows < MAP_MIN_SIDE ||
      doc.grid.rows > MAP_MAX_SIDE
    ) {
      issue(
        "grid-dims",
        `editor supports grid ${MAP_MIN_SIDE}..${MAP_MAX_SIDE} (persistence profile), got ${doc.grid.columns}x${doc.grid.rows}`,
      );
    }
  }

  // Render-подмножество: любой unsupported diagnostic = несовместимость.
  // (mask/spline/objects/scatter/non-rect rooms/non-cardinal doors/
  // non-terrain materials/unknown path kinds — см. createV5RenderModel).
  const { diagnostics } = createV5RenderModel(doc);
  for (const d of diagnostics) {
    issue(d.code, d.message);
  }

  // Terrain default: кисти/пипетка/ластик работают кодами builtin:terrain/*.
  for (const layer of doc.layers) {
    if (layer.kind !== "terrain") continue;
    const dm = layer.defaultMaterial;
    if (dm.type !== "builtin" || !dm.key.startsWith("terrain/")) {
      issue(
        "terrain-default-material",
        `layer ${layer.id}: brushes need a builtin terrain default material`,
      );
    }
  }

  // Path ambiguity (§6 ТЗ): brush работает с одним набором клеток на kind.
  // Несколько road/river cell-network paths — валидный V5, но редактор
  // не знает, какой редактировать.
  let roadNetworks = 0;
  let riverNetworks = 0;
  for (const layer of doc.layers) {
    if (layer.kind !== "path") continue;
    for (const p of layer.paths) {
      if (p.geometry.type !== "cell-network") continue;
      if (p.kind === "road") roadNetworks++;
      if (p.kind === "river") riverNetworks++;
    }
  }
  if (roadNetworks > 1) {
    issue("path-count", `editor edits a single road path, got ${roadNetworks}`);
  }
  if (riverNetworks > 1) {
    issue("path-count", `editor edits a single river path, got ${riverNetworks}`);
  }

  return { compatible: reasons.length === 0, reasons };
}
