import type { MapDocumentV6, Vec2 } from "@shared/maps/core";
import { shapeBounds } from "../scatter";
import { moveSelection, removeSelection, type WorkspaceSelection } from "./editorCommands";

export type SelectionRect = { x: number; y: number; w: number; h: number };
export function selectionRect(a: Vec2, b: Vec2): SelectionRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
export function selectableBounds(document: MapDocumentV6) {
  const entries: { selection: WorkspaceSelection; bounds: SelectionRect }[] = [];
  for (const layer of document.layers) {
    if (!layer.visible || layer.locked) continue;
    const push = (id: string, kind: WorkspaceSelection["kind"], bounds: SelectionRect) => entries.push({ selection: { id, layerId: layer.id, kind }, bounds });
    if (layer.kind === "object") for (const item of layer.items) {
      const { position, scale, rotation } = item.transform;
      const angle = rotation * Math.PI / 180;
      const w = Math.abs(scale.x * Math.cos(angle)) + Math.abs(scale.y * Math.sin(angle));
      const h = Math.abs(scale.x * Math.sin(angle)) + Math.abs(scale.y * Math.cos(angle));
      push(item.id, "object", { x: position.x - w / 2, y: position.y - h / 2, w, h });
    }
    else if (layer.kind === "label") for (const item of layer.items) push(item.id, "label", { x: item.position.x, y: item.position.y, w: 0, h: 0 });
    else if (layer.kind === "scatter") for (const area of layer.areas) push(area.id, "scatter", shapeBounds(area.shape));
    else if (layer.kind === "path") for (const path of layer.paths) {
      if (path.geometry.type !== "spline") continue;
      const points = path.geometry.nodes.flatMap(node => [node.position, ...(node.in ? [node.in] : []), ...(node.out ? [node.out] : [])]);
      if (!points.length) continue;
      const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
      const width = Math.max(path.width, ...path.geometry.nodes.map(node => node.width ?? path.width));
      push(path.id, "path", { x: x - width / 2, y: y - width / 2, w: Math.max(...points.map(p => p.x)) - x + width, h: Math.max(...points.map(p => p.y)) - y + width });
    }
    else if (layer.kind === "gameplay") for (const item of layer.items) {
      if (item.kind === "room") push(item.id, "gameplay", shapeBounds(item.geometry));
      else {
        const size = item.kind === "token" ? item.size : 1;
        push(item.id, item.kind === "token" ? "token" : "gameplay", { x: item.position.x - size / 2, y: item.position.y - size / 2, w: size, h: size });
      }
    }
  }
  return entries;
}
export function selectInRect(document: MapDocumentV6, rect: SelectionRect): WorkspaceSelection[] {
  return selectableBounds(document).filter(({ bounds: b }) => b.x <= rect.x + rect.w && b.x + b.w >= rect.x && b.y <= rect.y + rect.h && b.y + b.h >= rect.y).map(entry => entry.selection);
}
export function mergeSelections(base: readonly WorkspaceSelection[], added: readonly WorkspaceSelection[]) {
  return [...new Map([...base, ...added].map(entry => [`${entry.layerId}:${entry.id}`, entry])).values()];
}
export function moveSelections(document: MapDocumentV6, selections: readonly WorkspaceSelection[], delta: Vec2) {
  return selections.reduce((next, entry) => moveSelection(next, entry, delta), document);
}
export function removeSelections(document: MapDocumentV6, selections: readonly WorkspaceSelection[]) {
  return selections.reduce((next, entry) => removeSelection(next, entry), document);
}
