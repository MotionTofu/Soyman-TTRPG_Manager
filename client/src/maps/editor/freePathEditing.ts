import type { MapDocumentV5, MapPath, SplineNode } from "../core/types";
import { splineFromAnchors } from "../core/spline";

export type FreePathPoint = { x: number; y: number };

export interface FreePathHit {
  pathId: string;
  nodes: SplineNode[];
  handleIndex: number | null;
  handleKind: "anchor" | "in" | "out" | null;
  join?: FreePathJoin;
}

export interface FreePathJoin {
  segmentIndex: number;
  t: number;
  point: FreePathPoint;
}

export function freePathHandleIndices(nodes: readonly SplineNode[]): number[] {
  if (nodes.length < 2) return [];
  if (nodes.some((node) => node.in || node.out))
    return nodes.map((_, index) => index);
  const count = Math.min(nodes.length, 17);
  return Array.from({ length: count }, (_, index) =>
    Math.round(index * (nodes.length - 1) / (count - 1)));
}

function closestOnSegment(point: FreePathPoint, a: FreePathPoint, b: FreePathPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { distance: Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t), t };
}

const lerpPoint = (a: FreePathPoint, b: FreePathPoint, t: number) => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
});

export function splinePointAt(nodes: readonly SplineNode[], segmentIndex: number, t: number): FreePathPoint {
  const from = nodes[segmentIndex], to = nodes[segmentIndex + 1];
  if (!from.out || !to.in) return lerpPoint(from.position, to.position, t);
  const a = lerpPoint(from.position, from.out, t);
  const b = lerpPoint(from.out, to.in, t);
  const c = lerpPoint(to.in, to.position, t);
  return lerpPoint(lerpPoint(a, b, t), lerpPoint(b, c, t), t);
}

/** Split one segment exactly; the resulting two segments retain the old shape. */
export function insertSplineNodeAt(nodes: readonly SplineNode[], segmentIndex: number,
  t: number, baseWidth: number): { nodes: SplineNode[]; nodeIndex: number; point: FreePathPoint } | null {
  if (segmentIndex < 0 || segmentIndex >= nodes.length - 1 || !Number.isFinite(t) ||
    t <= 0.001 || t >= 0.999) return null;
  const from = nodes[segmentIndex], to = nodes[segmentIndex + 1];
  const point = splinePointAt(nodes, segmentIndex, t);
  const width = (from.width ?? baseWidth) + ((to.width ?? baseWidth) - (from.width ?? baseWidth)) * t;
  let left = from, right = to, inserted: SplineNode = { position: point, width };
  if (from.out && to.in) {
    const a = lerpPoint(from.position, from.out, t);
    const b = lerpPoint(from.out, to.in, t);
    const c = lerpPoint(to.in, to.position, t);
    const d = lerpPoint(a, b, t), e = lerpPoint(b, c, t);
    left = { ...from, out: a };
    right = { ...to, in: c };
    inserted = { position: point, in: d, out: e, width };
  }
  const updated = [...nodes];
  updated.splice(segmentIndex, 2, left, inserted, right);
  return { nodes: updated, nodeIndex: segmentIndex + 1, point };
}

function nearestSplineJoin(nodes: readonly SplineNode[], point: FreePathPoint,
  scale: number): { join: FreePathJoin; distance: number } | null {
  let best: { join: FreePathJoin; distance: number } | null = null;
  for (let segmentIndex = 0; segmentIndex < nodes.length - 1; segmentIndex++) {
    const from = nodes[segmentIndex], to = nodes[segmentIndex + 1];
    const controlLength = from.out && to.in
      ? Math.hypot(from.out.x - from.position.x, from.out.y - from.position.y) +
        Math.hypot(to.in.x - from.out.x, to.in.y - from.out.y) +
        Math.hypot(to.position.x - to.in.x, to.position.y - to.in.y)
      : Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y);
    const count = Math.max(8, Math.min(1024, Math.ceil(controlLength * scale / 3)));
    let previous = from.position;
    for (let sample = 1; sample <= count; sample++) {
      const current = splinePointAt(nodes, segmentIndex, sample / count);
      const nearest = closestOnSegment(point, previous, current);
      if (!best || nearest.distance < best.distance) {
        const t = Math.max(0.01, Math.min(0.99, (sample - 1 + nearest.t) / count));
        best = { distance: nearest.distance,
          join: { segmentIndex, t, point: splinePointAt(nodes, segmentIndex, t) } };
      }
      previous = current;
    }
  }
  return best;
}

export function hitEditableFreePath(doc: MapDocumentV5 | null, kind: "road" | "river",
  selectedId: string | null, point: FreePathPoint, scale: number): FreePathHit | null {
  if (!doc || !Number.isFinite(scale) || scale <= 0) return null;
  const paths: MapPath[] = doc.layers.flatMap((layer) => layer.kind === "path" && layer.visible && !layer.locked
    ? layer.paths.filter((path) => path.kind === kind && path.geometry.type === "spline") : []);
  const selected = paths.find((path) => path.id === selectedId);
  if (selected?.geometry.type === "spline") {
    let nearestIndex: number | null = null;
    let nearestKind: FreePathHit["handleKind"] = null;
    let nearestDistance = 9 / scale;
    for (const index of freePathHandleIndices(selected.geometry.nodes)) {
      const node = selected.geometry.nodes[index];
      for (const kind of ["anchor", "in", "out"] as const) {
        const target = kind === "anchor" ? node.position : node[kind];
        if (!target) continue;
        const distance = Math.hypot(point.x - target.x, point.y - target.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
          nearestKind = kind;
        }
      }
    }
    if (nearestIndex !== null)
      return { pathId: selected.id, nodes: selected.geometry.nodes,
        handleIndex: nearestIndex, handleKind: nearestKind };
  }
  const tolerance = 8 / scale;
  for (const path of paths.reverse()) {
    if (path.geometry.type !== "spline") continue;
    const nodes = path.geometry.nodes;
    const nearest = nearestSplineJoin(nodes, point, scale);
    const maxWidth = nodes.reduce((width, node) => Math.max(width, node.width ?? path.width), path.width);
    if (nearest && nearest.distance <= tolerance + maxWidth / 2)
      return { pathId: path.id, nodes, handleIndex: null, handleKind: null, join: nearest.join };
  }
  return null;
}

export function deformFreePath(nodes: readonly SplineNode[], anchorIndex: number,
  dx: number, dy: number): SplineNode[] {
  if (anchorIndex < 0 || anchorIndex >= nodes.length || !Number.isFinite(dx) || !Number.isFinite(dy))
    return nodes.map((node) => ({ position: { ...node.position },
      ...(node.in ? { in: { ...node.in } } : {}),
      ...(node.out ? { out: { ...node.out } } : {}),
      ...(node.width !== undefined ? { width: node.width } : {}) }));
  const hasHandles = nodes.some((node) => node.in || node.out);
  const distances = [0];
  for (let i = 1; i < nodes.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(nodes[i].position.x - nodes[i - 1].position.x,
      nodes[i].position.y - nodes[i - 1].position.y));
  }
  const radius = Math.max(0.5, Math.min(1.5, distances.at(-1)! * 0.25));
  return nodes.map((node, index) => {
    const normalized = hasHandles ? (index === anchorIndex ? 1 : 0)
      : Math.max(0, 1 - Math.abs(distances[index] - distances[anchorIndex]) / radius);
    const weight = normalized * normalized * (3 - 2 * normalized);
    const shift = (point: { x: number; y: number }) =>
      ({ x: point.x + dx * weight, y: point.y + dy * weight });
    return { position: shift(node.position),
      ...(node.in ? { in: shift(node.in) } : {}),
      ...(node.out ? { out: shift(node.out) } : {}),
      ...(node.width !== undefined ? { width: node.width } : {}) };
  });
}

export function moveSplineHandle(nodes: readonly SplineNode[], index: number,
  kind: "in" | "out", dx: number, dy: number): SplineNode[] {
  const node = nodes[index];
  if (!node?.[kind] || !Number.isFinite(dx) || !Number.isFinite(dy)) return nodes.map((item) => ({ ...item }));
  const moved = { x: node[kind]!.x + dx, y: node[kind]!.y + dy };
  const opposite = kind === "in" ? "out" : "in";
  const mirror = node[opposite]
    ? { x: 2 * node.position.x - moved.x, y: 2 * node.position.y - moved.y } : undefined;
  return nodes.map((item, itemIndex) => itemIndex === index
    ? { ...item, [kind]: moved, ...(mirror ? { [opposite]: mirror } : {}) } : item);
}

export function setSplineNodeLinear(nodes: readonly SplineNode[], index: number,
  linear: boolean): SplineNode[] {
  const suggested = splineFromAnchors(nodes.map((node) => node.position))[index];
  return nodes.map((node, itemIndex) => {
    if (itemIndex !== index) return node;
    const rest: SplineNode = { position: { ...node.position },
      ...(node.width !== undefined ? { width: node.width } : {}) };
    return linear ? rest : { ...rest, ...(suggested.in ? { in: suggested.in } : {}),
      ...(suggested.out ? { out: suggested.out } : {}) };
  });
}

/** Add points to the selected end without rebuilding the existing curve. */
export function extendSplineNodes(nodes: readonly SplineNode[], anchors: readonly FreePathPoint[],
  end: "start" | "end", baseWidth: number): SplineNode[] {
  if (nodes.length < 2 || anchors.length < 2) return [...nodes];
  const endpoint = end === "end" ? nodes.at(-1)! : nodes[0];
  if (Math.hypot(anchors[0].x - endpoint.position.x,
    anchors[0].y - endpoint.position.y) > 1e-6) return [...nodes];
  const width = endpoint.width ?? baseWidth;
  const added = splineFromAnchors(anchors).slice(1).map((node) => ({ ...node, width }));
  const mirror = (point: FreePathPoint) => ({
    x: 2 * endpoint.position.x - point.x,
    y: 2 * endpoint.position.y - point.y,
  });
  if (end === "end") {
    const joined = endpoint.in && !endpoint.out ? { ...endpoint, out: mirror(endpoint.in) } : endpoint;
    return [...nodes.slice(0, -1), joined, ...added];
  }
  const joined = endpoint.out && !endpoint.in ? { ...endpoint, in: mirror(endpoint.out) } : endpoint;
  const reversed = added.reverse().map((node) => ({
    position: { ...node.position }, width: node.width,
    ...(node.out ? { in: { ...node.out } } : {}),
    ...(node.in ? { out: { ...node.in } } : {}),
  }));
  return [...reversed, joined, ...nodes.slice(1)];
}

/** A branch shares its first position and width with the chosen parent point. */
export function branchSplineNodes(parent: SplineNode, anchors: readonly FreePathPoint[],
  baseWidth: number): SplineNode[] {
  if (anchors.length < 2 || Math.hypot(anchors[0].x - parent.position.x,
    anchors[0].y - parent.position.y) > 1e-6) return [];
  const width = parent.width ?? baseWidth;
  return splineFromAnchors(anchors).map((node) => ({ ...node, width }));
}
