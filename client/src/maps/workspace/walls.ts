import type { MapDocumentV6, Vec2 } from "@shared/maps/core";
import { CRYPT_PACK } from "../assets/crypt";
import { createSplinePath } from "../core/mutations/paths";
import { editGeometry } from "./editDocument";
import { requireEditableLayer } from "./editorCommands";
import { wallPoints } from "../wallGeometry";

export function wallPoint(document: MapDocumentV6, point: Vec2, snap: boolean): Vec2 {
  if (!snap || document.grid?.type !== "square") return point;
  return { x: Math.max(0, Math.min(document.grid.columns, Math.round(point.x))), y: Math.max(0, Math.min(document.grid.rows, Math.round(point.y))) };
}
export function addWall(document: MapDocumentV6, layerId: string, points: readonly Vec2[], width: number, closed = false) {
  requireEditableLayer(document, layerId, "path");
  const anchors = wallPoints(points, closed);
  if (anchors.length < (closed ? 3 : 2)) return document;
  const installed = document.assetPacks.find(pack => pack.id === CRYPT_PACK.id);
  if (installed && installed.version !== CRYPT_PACK.version) throw new Error("Эта карта использует другую версию набора стен");
  const base = installed ? document : { ...document, assetPacks: [...document.assetPacks, CRYPT_PACK] };
  return editGeometry(base, view => createSplinePath(view, layerId, { id: crypto.randomUUID(), kind: "wall", width,
    styleRef: { type: "builtin", key: "path/wall" }, nodes: anchors.map(position => ({ position })), properties: { closed } }));
}
export function setWallClosed(document: MapDocumentV6, layerId: string, id: string, closed: boolean) {
  const layer = requireEditableLayer(document, layerId, "path");
  if (layer.kind !== "path") return document;
  const path = layer.paths.find(p => p.id === id);
  if (!path || path.kind !== "wall" || path.geometry.type !== "spline" || closed && path.geometry.nodes.length < 3) return document;
  return editGeometry(document, view => ({ ok: true, changed: true, document: { ...view, layers: view.layers.map(entry => entry.id === layerId && entry.kind === "path"
    ? { ...entry, paths: entry.paths.map(p => p.id === id ? { ...p, properties: { ...p.properties, closed } } : p) } : entry) } }));
}
