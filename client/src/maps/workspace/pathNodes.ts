import { pathNodesFromAnchors } from "./pathAnchors";
import type { MapDocumentV6, SplineNode, Vec2 } from "@shared/maps/core";
import { updateSplinePath } from "../core/mutations/paths";
import { selectedPath } from "./artisticCommands";
import { editGeometry } from "./editDocument";
import { requireEditableLayer, type WorkspaceSelection } from "./editorCommands";

export function pathNodeIntervals(count: number, selected: readonly number[], closed: boolean) {
  const indices = new Set(selected);
  return Array.from({ length: closed ? count : count - 1 }, (_, i) => i)
    .filter(i => indices.has(i) && indices.has((i + 1) % count));
}
export function setPathNodeWidth(doc: MapDocumentV6, selection: WorkspaceSelection, indices: readonly number[], width?: number) {
  requireEditableLayer(doc, selection.layerId, "path");
  const path = selectedPath(doc, selection);
  if (!path || path.geometry.type !== "spline") return doc;
  const nodes = path.geometry.nodes.map((node, i) => {
    if (!indices.includes(i)) return node;
    const { width: oldWidth, ...rest } = node;
    void oldWidth;
    return width === undefined ? rest : { ...rest, width: Math.max(.05, Math.min(4, width)) };
  });
  return editGeometry(doc, view => updateSplinePath(view, path.id, { nodes }));
}
export function insertPathNodes(doc: MapDocumentV6, selection: WorkspaceSelection, selected: readonly number[]) {
  requireEditableLayer(doc, selection.layerId, "path");
  const path = selectedPath(doc, selection);
  if (!path || path.geometry.type !== "spline") return { document: doc, indices: [...selected] };
  const original = path.geometry.nodes;
  const intervals = pathNodeIntervals(original.length, selected, path.properties?.closed === true);
  if (!intervals.length || original.length + intervals.length > 256) return { document: doc, indices: [...selected] };
  let next = doc;
  for (const index of [...intervals].reverse()) {
    const current = selectedPath(next, selection)!;
    if (current.geometry.type !== "spline") continue;
    const nodes = [...current.geometry.nodes], a = nodes[index], bIndex = (index + 1) % original.length, b = nodes[bIndex];
    const lerp = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    let middle: SplineNode = { position: lerp(a.position, b.position) };
    if (path.kind !== "wall" && a.out && b.in) {
      const q0 = lerp(a.position, a.out), q1 = lerp(a.out, b.in), q2 = lerp(b.in, b.position);
      const r0 = lerp(q0, q1), r1 = lerp(q1, q2);
      nodes[index] = { ...a, out: q0 }; nodes[bIndex] = { ...b, in: q2 };
      middle = { position: lerp(r0, r1), in: r0, out: r1 };
    }
    if (a.width !== undefined || b.width !== undefined) middle.width = ((a.width ?? path.width) + (b.width ?? path.width)) / 2;
    nodes.splice(index + 1, 0, middle);
    next = editGeometry(next, view => updateSplinePath(view, path.id, { nodes, insertedAt: { index: index + 1, count: 1 } }));
  }
  return { document: next, indices: intervals.map((index, i) => index + 1 + i) };
}

export function setPathClosed(doc: MapDocumentV6, selection: WorkspaceSelection, closed: boolean) {
  requireEditableLayer(doc, selection.layerId, "path");
  const path = selectedPath(doc, selection);
  if (!path || path.geometry.type !== "spline" || closed && path.geometry.nodes.length < 3) return doc;
  if ((path.properties?.closed === true) === closed) return doc;
  const originals = path.geometry.nodes;
  const smooth = closed && path.kind !== "wall" ? pathNodesFromAnchors(originals.map(node => node.position), true) : null;
  const nodes = originals.map((node, i) => ({ ...node,
    ...(smooth && i === 0 && !node.in ? { in: smooth[i].in } : {}),
    ...(smooth && i === originals.length - 1 && !node.out ? { out: smooth[i].out } : {}) }));
  return editGeometry(doc, view => {
    const result = updateSplinePath(view, path.id, { nodes });
    if (!result.ok) return result;
    return { ok: true, changed: true, document: { ...result.document, layers: result.document.layers.map(layer => layer.id === selection.layerId && layer.kind === "path"
      ? { ...layer, paths: layer.paths.map(p => p.id === path.id ? { ...p, properties: { ...p.properties, closed } } : p) } : layer) } };
  });
}
