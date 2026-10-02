import { pathNodesFromAnchors } from "./pathAnchors";
import { CARTOGRAPHY_PACK, CARTOGRAPHY_SCATTER } from "../assets/cartography";
import type { MapDocumentV6, ScatterArea, SplineNode, Vec2 } from "@shared/maps/core";
import { createSplinePath, updateSplinePath, deletePath } from "../core/mutations/paths";
import { paintTerrainMaskStroke } from "../core/mutations/terrainMask";
import { flattenSplineNodes, flattenSplineWithWidths } from "../core/spline";
import { builtinMaterial } from "../core";
import { scatterInstances, SCATTER_LIMIT, translateShape } from "../scatter";
import { editGeometry } from "./editDocument";
import { requireEditableLayer, type WorkspaceSelection } from "./editorCommands";

export function paintSurface(document: MapDocumentV6, layerId: string, a: Vec2, b: Vec2, radius: number, material: string | null) {
  return paintSurfaceStroke(document, layerId, [a, b], radius, material);
}
export function paintSurfaceStroke(document: MapDocumentV6, layerId: string, points: readonly Vec2[], radius: number, material: string | null) {
  const layer = requireEditableLayer(document, layerId, "terrain");
  if (layer.kind !== "terrain" || layer.representation !== "mask") throw new Error("Выберите слой плавной поверхности");
  if (!(radius >= 0.25 && radius <= 8)) throw new Error("Размер кисти должен быть от 0,25 до 8");
  return editGeometry(document, view => paintTerrainMaskStroke(view, layerId, points, radius,
    material === null ? null : builtinMaterial(material), () => crypto.randomUUID()));
}
export function addFreePath(document: MapDocumentV6, layerId: string, points: Vec2[], kind: "road" | "river", width: number, closed = false) {
  requireEditableLayer(document, layerId, "path");
  if (points.length < 2 || Math.hypot(points.at(-1)!.x - points[0].x, points.at(-1)!.y - points[0].y) < 0.1 && points.length === 2) return document;
  return editGeometry(document, view => createSplinePath(view, layerId, { id: crypto.randomUUID(), kind,
    styleRef: { type: "builtin", key: `path/${kind}` }, width, nodes: pathNodesFromAnchors(points, closed), properties: { closed } }));
}
export function selectedPath(document: MapDocumentV6, selection: WorkspaceSelection | null) {
  const layer = document.layers.find(layer => layer.id === selection?.layerId);
  const path = layer?.kind === "path" ? layer.paths.find(path => path.id === selection?.id) : undefined;
  return path?.geometry.type === "spline" ? path : undefined;
}
export function editPathNode(document: MapDocumentV6, selection: WorkspaceSelection, index: number, handle: "position" | "in" | "out", point: Vec2) {
  requireEditableLayer(document, selection.layerId, "path");
  const path = selectedPath(document, selection); if (!path || path.geometry.type !== "spline") return document;
  const nodes = path.geometry.nodes.map((node, i) => {
    if (i !== index) return node;
    const delta = { x: point.x - node.position.x, y: point.y - node.position.y };
    const shifted = (p: Vec2) => ({ x: p.x + delta.x, y: p.y + delta.y });
    return handle === "position" ? { ...node, position: point, ...(node.in ? { in: shifted(node.in) } : {}), ...(node.out ? { out: shifted(node.out) } : {}) } : { ...node, [handle]: point };
  });
  return editGeometry(document, view => updateSplinePath(view, path.id, { nodes }));
}
export function pathHit(nodes: readonly SplineNode[], point: Vec2, tolerance: number) {
  const line = flattenSplineNodes(nodes, Math.max(0.1, tolerance));
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= tolerance) return true;
  }
  return false;
}
export function addScatter(document: MapDocumentV6, layerId: string, point: Vec2, radius: number, profile: string, density: number, size: number, seed: number) {
  const layer = requireEditableLayer(document, layerId, "scatter"); if (layer.kind !== "scatter") return document;
  const area: ScatterArea = { id: crypto.randomUUID(), shape: { type: "ellipse", center: point, rx: radius, ry: radius },
    profileRef: { type: "builtin", key: profile }, seed, density, overrides: { size } };
  return putScatter(document, layerId, area);
}
export function putScatter(document: MapDocumentV6, layerId: string, area: ScatterArea) {
  const layer = requireEditableLayer(document, layerId, "scatter"); if (layer.kind !== "scatter") return document;
  const areas = layer.areas.some(a => a.id === area.id) ? layer.areas.map(a => a.id === area.id ? area : a) : [...layer.areas, area];
  let count = 0;
  for (const entry of areas) {
    const instances = scatterInstances(entry); if (instances.error) throw new Error(instances.error);
    count += instances.items.length;
  }
  if (count > SCATTER_LIMIT) throw new Error("На слое уже 5000 символов. Уменьшите плотность или создайте другой слой");
  const usesArtwork = areas.some(entry => entry.profileRef.type === "builtin" && CARTOGRAPHY_SCATTER.some(profile => profile.key === (entry.profileRef.type === "builtin" ? entry.profileRef.key : null)));
  const installed = document.assetPacks.find(pack => pack.id === CARTOGRAPHY_PACK.id);
  if (usesArtwork && installed && installed.version !== CARTOGRAPHY_PACK.version) throw new Error("Эта карта использует другую версию картографии");
  const base = usesArtwork && !installed ? { ...document, assetPacks: [...document.assetPacks, CARTOGRAPHY_PACK] } : document;
  return editGeometry(base, view => ({ ok: true, changed: true, document: { ...view, layers: view.layers.map(l => l.id === layerId && l.kind === "scatter" ? { ...l, areas } : l) } }));
}
export function moveArtSelection(document: MapDocumentV6, selection: WorkspaceSelection, delta: Vec2) {
  const layer = requireEditableLayer(document, selection.layerId);
  if (layer.kind === "scatter") {
    const area = layer.areas.find(a => a.id === selection.id); if (!area) return document;
    return putScatter(document, layer.id, { ...area, shape: translateShape(area.shape, delta) });
  }
  const path = selectedPath(document, selection);
  if (!path || path.geometry.type !== "spline") return document;
  const translate = (p: Vec2) => ({ x: p.x + delta.x, y: p.y + delta.y });
  return editGeometry(document, view => updateSplinePath(view, path.id, { nodes: path.geometry.type === "spline" ? path.geometry.nodes.map(n =>
    ({ ...n, position: translate(n.position), ...(n.in ? { in: translate(n.in) } : {}), ...(n.out ? { out: translate(n.out) } : {}) })) : [] }));
}
export function removeArtSelection(document: MapDocumentV6, selection: WorkspaceSelection) {
  requireEditableLayer(document, selection.layerId);
  return editGeometry(document, view => selection.kind === "path" ? deletePath(view, selection.id) :
    { ok: true, changed: true, document: { ...view, layers: view.layers.map(l => l.id === selection.layerId && l.kind === "scatter" ? { ...l, areas: l.areas.filter(a => a.id !== selection.id) } : l) } });
}

export function freePathHit(nodes: readonly SplineNode[], point: Vec2, width: number, slack: number, closed = false) {
  const samples = flattenSplineWithWidths(closed ? [...nodes, nodes[0]] : nodes, width, Math.max(.05, slack));
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= (a.width + (b.width - a.width) * t) / 2 + slack) return true;
  }
  return false;
}
