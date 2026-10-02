import type { MapDocumentV6 } from "@shared/maps/core";
import type { ShapeGeometry } from "../core/types";
import { applyTerrainCellEdits, builtinMaterial } from "../core";
import { cellCenter } from "../grid";
import { shapeBounds, shapeContains } from "../scatter";
import { editGeometry } from "./editDocument";
import { requireEditableLayer, type WorkspaceSelection } from "./editorCommands";

export function selectedRoomShapes(document: MapDocumentV6, selections: readonly WorkspaceSelection[]): ShapeGeometry[] {
  return selections.flatMap<ShapeGeometry>(selection => {
    const layer = document.layers.find(l => l.id === selection.layerId);
    if (layer?.kind === "path" && layer.visible) {
      const wall = layer.paths.find(path => path.id === selection.id && path.kind === "wall" && path.properties?.closed === true);
      if (wall?.geometry.type === "spline" && wall.geometry.nodes.length >= 3) return [{ type: "polygon" as const, points: wall.geometry.nodes.map(node => node.position) }];
    }
    const room = layer?.kind === "gameplay" && layer.visible ? layer.items.find(item => item.id === selection.id && item.kind === "room") : null;
    return room?.kind === "room" ? [room.geometry] : [];
  });
}
/** One batch and one history step, even for overlapping selected rooms. */
export function paintCellShapes(document: MapDocumentV6, layerId: string, shapes: readonly ShapeGeometry[], material: string | null) {
  const layer = requireEditableLayer(document, layerId, "terrain"), grid = document.grid;
  if (layer.kind !== "terrain" || layer.representation !== "cells" || !grid) throw new Error("Выберите клеточный слой пола");
  const edits = new Map<string, { x: number; y: number; material: ReturnType<typeof builtinMaterial> | null }>();
  for (const shape of shapes) {
    const b = shapeBounds(shape), hex = grid.type === "hex";
    const minY = Math.max(0, Math.floor(b.y / (hex ? 1.5 : 1)) - (hex ? 1 : 0));
    const maxY = Math.min(grid.rows - 1, Math.ceil((b.y + b.h) / (hex ? 1.5 : 1)));
    const minX = Math.max(0, Math.floor(b.x / (hex ? Math.sqrt(3) : 1)) - (hex ? 1 : 0));
    const maxX = Math.min(grid.columns - 1, Math.ceil((b.x + b.w) / (hex ? Math.sqrt(3) : 1)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const center = cellCenter(grid.type, x, y);
      if (shapeContains(shape, { x: center.cx, y: center.cy })) edits.set(`${x},${y}`, { x, y, material: material === null ? null : builtinMaterial(material) });
    }
  }
  return edits.size ? editGeometry(document, view => applyTerrainCellEdits(view, layerId, [...edits.values()])) : document;
}
