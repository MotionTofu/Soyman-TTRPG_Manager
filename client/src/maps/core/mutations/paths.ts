// Path mutations: cell-network editing and free spline creation/deletion.
// Existing spline editing through cell operations stays unsupported. Empty cell-network
// invalid: удаление последней клетки удаляет path целиком.

import { isStyleRef } from "../refs";
import type { StyleRef } from "../refs";
import type {
  EntityId,
  MapDocumentV5,
  MapPath,
  PathLayer,
  SplineNode,
} from "../types";
import {
  changed,
  collectIds,
  findLayer,
  noChange,
  withReplacedLayer,
  mutationError,
  type MutationResult,
} from "./helpers";

export interface CellNetworkPathSpec {
  id: EntityId;
  kind: string;
  styleRef: StyleRef;
  width: number;
  cells: Array<{ x: number; y: number }>;
}

export interface SplinePathSpec {
  id: EntityId;
  kind: "road" | "river";
  styleRef: StyleRef;
  width: number;
  nodes: SplineNode[];
  branchFrom?: { pathId: EntityId; nodeIndex: number };
}

function validSplineNodes(nodes: readonly SplineNode[]): boolean {
  return nodes.length >= 2 && nodes.every((node) => node.position &&
    Number.isFinite(node.position.x) && Number.isFinite(node.position.y) &&
    (node.width === undefined || (Number.isFinite(node.width) && node.width > 0)) &&
    [node.in, node.out].every((point) => !point ||
      (Number.isFinite(point.x) && Number.isFinite(point.y))));
}

function copySplineNodes(nodes: readonly SplineNode[]): SplineNode[] {
  return nodes.map((node) => ({ position: { ...node.position },
    ...(node.in ? { in: { ...node.in } } : {}),
    ...(node.out ? { out: { ...node.out } } : {}),
    ...(node.width !== undefined ? { width: node.width } : {}) }));
}

function samePoint(a?: { x: number; y: number }, b?: { x: number; y: number }): boolean {
  return a === undefined ? b === undefined : b !== undefined && a.x === b.x && a.y === b.y;
}

interface ResolvedPath {
  layerIndex: number;
  layer: PathLayer;
  pathIndex: number;
  path: MapPath;
}

function resolvePath(doc: MapDocumentV5, pathId: string): ResolvedPath | { error: MutationResult } {
  for (let li = 0; li < doc.layers.length; li++) {
    const layer = doc.layers[li];
    if (layer.kind !== "path") continue;
    const pi = layer.paths.findIndex((p) => p.id === pathId);
    if (pi !== -1) return { layerIndex: li, layer, pathIndex: pi, path: layer.paths[pi] };
  }
  return {
    error: mutationError("path.unknown-id", "pathId", `path "${pathId}" does not exist`),
  };
}

function checkCells(
  doc: MapDocumentV5,
  cells: Array<{ x: number; y: number }>,
  path: string,
): MutationResult | null {
  const grid = doc.grid;
  if (!grid) {
    return mutationError("path.cell-network.no-grid", "grid", "cell-network requires document.grid");
  }
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) {
      return mutationError("path.bad-cell", `${path}[${i}]`, "cell x/y must be integers");
    }
    if (c.x < 0 || c.y < 0 || c.x >= grid.columns || c.y >= grid.rows) {
      return mutationError(
        "path.cell-out-of-grid",
        `${path}[${i}]`,
        `cell (${c.x},${c.y}) outside ${grid.columns}x${grid.rows}`,
      );
    }
  }
  return null;
}

function sortCells(cells: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}

function withPaths(doc: MapDocumentV5, layerIndex: number, layer: PathLayer, paths: MapPath[]): MutationResult {
  return changed(withReplacedLayer(doc, layerIndex, { ...layer, paths }));
}

function requireCellNetwork(path: MapPath): MutationResult | null {
  if (path.geometry.type !== "cell-network") {
    return mutationError(
      "path.unsupported-spline",
      "pathId",
      `path "${path.id}" is a free line; cell editing applies only to cell-network paths`,
    );
  }
  return null;
}

/** Добавить клетки в cell-network (batch; дубликаты = no-op). Атомарно. */
export function addPathCells(
  doc: MapDocumentV5,
  pathId: string,
  cells: Array<{ x: number; y: number }>,
): MutationResult {
  const resolved = resolvePath(doc, pathId);
  if ("error" in resolved) return resolved.error;
  const badGeometry = requireCellNetwork(resolved.path);
  if (badGeometry) return badGeometry;
  const bad = checkCells(doc, cells, "cells");
  if (bad) return bad;

  const have = new Set(
    (resolved.path.geometry.type === "cell-network" ? resolved.path.geometry.cells : []).map(
      (c) => `${c.x},${c.y}`,
    ),
  );
  let touched = false;
  for (const c of cells) {
    const key = `${c.x},${c.y}`;
    if (!have.has(key)) {
      have.add(key);
      touched = true;
    }
  }
  if (!touched) return noChange(doc);
  const merged = sortCells([...have].map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  }));
  const paths = [...resolved.layer.paths];
  paths[resolved.pathIndex] = {
    ...resolved.path,
    geometry: { type: "cell-network", cells: merged },
  };
  return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
}

/** Убрать клетки; удаление последней удаляет path целиком. */
export function removePathCells(
  doc: MapDocumentV5,
  pathId: string,
  cells: Array<{ x: number; y: number }>,
): MutationResult {
  const resolved = resolvePath(doc, pathId);
  if ("error" in resolved) return resolved.error;
  const badGeometry = requireCellNetwork(resolved.path);
  if (badGeometry) return badGeometry;

  const drop = new Set(cells.map((c) => `${c.x},${c.y}`));
  const geometry = resolved.path.geometry;
  if (geometry.type !== "cell-network") {
    // Недостижимо (проверено выше), но сохраняет типовую безопасность без кастов.
    return mutationError("path.unsupported-spline", "pathId", `path "${pathId}" is spline`);
  }
  const kept = geometry.cells.filter((c) => !drop.has(`${c.x},${c.y}`));
  if (kept.length === geometry.cells.length) return noChange(doc);
  if (kept.length === 0) {
    const paths = resolved.layer.paths.filter((_, i) => i !== resolved.pathIndex);
    return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
  }
  const paths = [...resolved.layer.paths];
  paths[resolved.pathIndex] = {
    ...resolved.path,
    geometry: { type: "cell-network", cells: sortCells(kept) },
  };
  return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
}

/** Заменить множество клеток целиком (пустое = удалить path). */
export function replacePathCells(
  doc: MapDocumentV5,
  pathId: string,
  cells: Array<{ x: number; y: number }>,
): MutationResult {
  const resolved = resolvePath(doc, pathId);
  if ("error" in resolved) return resolved.error;
  const badGeometry = requireCellNetwork(resolved.path);
  if (badGeometry) return badGeometry;
  const bad = checkCells(doc, cells, "cells");
  if (bad) return bad;

  const seen = new Set<string>();
  for (const c of cells) seen.add(`${c.x},${c.y}`);
  if (seen.size === 0) {
    const paths = resolved.layer.paths.filter((_, i) => i !== resolved.pathIndex);
    return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
  }
  const geometry = resolved.path.geometry;
  if (geometry.type !== "cell-network") {
    return mutationError("path.unsupported-spline", "pathId", `path "${pathId}" is spline`);
  }
  const current = new Set(geometry.cells.map((c) => `${c.x},${c.y}`));
  if (current.size === seen.size && [...seen].every((k) => current.has(k))) {
    return noChange(doc);
  }
  const paths = [...resolved.layer.paths];
  paths[resolved.pathIndex] = {
    ...resolved.path,
    geometry: { type: "cell-network", cells: sortCells([...seen].map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    })) },
  };
  return withPaths(doc, resolved.layerIndex, resolved.layer, paths);
}

/** Создать cell-network path. ID приходит извне (без random). */
export function createCellNetworkPath(
  doc: MapDocumentV5,
  layerId: string,
  spec: CellNetworkPathSpec,
): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found) {
    return mutationError("path.unknown-layer", "layerId", `layer "${layerId}" does not exist`);
  }
  if (found.layer.kind !== "path") {
    return mutationError(
      "path.wrong-layer-kind",
      "layerId",
      `layer "${layerId}" is ${found.layer.kind}, not path`,
    );
  }
  if (typeof spec.id !== "string" || spec.id.length === 0) {
    return mutationError("path.bad-id", "spec.id", "path id must be a non-empty string");
  }
  if (collectIds(doc).has(spec.id)) {
    return mutationError("path.duplicate-id", "spec.id", `id "${spec.id}" already exists in document`);
  }
  if (typeof spec.kind !== "string" || spec.kind.length === 0) {
    return mutationError("path.bad-kind", "spec.kind", "path kind must be a non-empty string");
  }
  if (!isStyleRef(spec.styleRef)) {
    return mutationError("path.bad-style-ref", "spec.styleRef", "expected builtin | asset style ref");
  }
  if (typeof spec.width !== "number" || !Number.isFinite(spec.width) || spec.width <= 0) {
    return mutationError("path.bad-width", "spec.width", "width must be > 0");
  }
  if (!Array.isArray(spec.cells) || spec.cells.length === 0) {
    return mutationError("path.empty-cells", "spec.cells", "cell-network needs >= 1 cell (empty is invalid)");
  }
  const bad = checkCells(doc, spec.cells, "spec.cells");
  if (bad) return bad;
  const seen = new Set(spec.cells.map((c) => `${c.x},${c.y}`));

  const path: MapPath = {
    id: spec.id,
    kind: spec.kind,
    geometry: {
      type: "cell-network",
      cells: sortCells([...seen].map((key) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y };
      })),
    },
    width: spec.width,
    styleRef: spec.styleRef,
  };
  const paths = [...found.layer.paths, path];
  const result = withPaths(doc, found.index, found.layer, paths);
  if (result.ok) return { ...result, entityId: spec.id };
  return result;
}

/** Store a road/river spline in world coordinates in one history step. */
export function createSplinePath(doc: MapDocumentV5, layerId: string, spec: SplinePathSpec): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found || found.layer.kind !== "path")
    return mutationError("path.wrong-layer-kind", "layerId", "expected a path layer");
  if (!spec.id || collectIds(doc).has(spec.id))
    return mutationError("path.duplicate-id", "spec.id", "path id is empty or already used");
  if (!isStyleRef(spec.styleRef))
    return mutationError("path.bad-style-ref", "spec.styleRef", "expected builtin | asset style ref");
  if (!Number.isFinite(spec.width) || spec.width <= 0)
    return mutationError("path.bad-width", "spec.width", "width must be > 0");
  if (!validSplineNodes(spec.nodes))
    return mutationError("path.bad-nodes", "spec.nodes", "spline needs at least two finite nodes and handles");
  if (!spec.nodes.some((node) => Math.hypot(node.position.x - spec.nodes[0].position.x,
    node.position.y - spec.nodes[0].position.y) > 1e-6))
    return mutationError("path.zero-length", "spec.nodes", "free path needs two distinct points");
  if (spec.branchFrom) {
    const parent = resolvePath(doc, spec.branchFrom.pathId);
    if ("error" in parent || parent.path.geometry.type !== "spline" ||
      parent.path.kind !== spec.kind || !Number.isInteger(spec.branchFrom.nodeIndex) ||
      spec.branchFrom.nodeIndex < 0 ||
      !samePoint(parent.path.geometry.nodes[spec.branchFrom.nodeIndex]?.position,
        spec.nodes[0].position))
      return mutationError("path.bad-branch", "spec.branchFrom", "branch must begin at a node of a matching spline");
  }
  const path: MapPath = {
    id: spec.id, kind: spec.kind, styleRef: spec.styleRef, width: spec.width,
    geometry: { type: "spline", nodes: copySplineNodes(spec.nodes) },
    ...(spec.branchFrom ? { branchFrom: { ...spec.branchFrom } } : {}),
  };
  return withPaths(doc, found.index, found.layer, [...found.layer.paths, path]);
}

export function deletePath(doc: MapDocumentV5, pathId: string): MutationResult {
  const found = resolvePath(doc, pathId);
  if ("error" in found) return found.error;
  return changed({ ...doc, layers: doc.layers.map((layer) => layer.kind !== "path" ? layer : {
    ...layer, paths: layer.paths.filter((path) => path.id !== pathId).map((path) => {
      if (path.branchFrom?.pathId !== pathId) return path;
      const { branchFrom: _branchFrom, ...detached } = path;
      return detached;
    }),
  }) });
}

function syncAttachedBranches(doc: MapDocumentV5, parentId: string,
  oldNodes: readonly SplineNode[], newNodes: readonly SplineNode[],
  oldWidth: number, newWidth: number,
  insertion: { index: number; count: number } | null): MapDocumentV5 {
  let layers = doc.layers;
  const visited = new Set<string>();
  const follow = (sourceId: string, before: readonly SplineNode[], after: readonly SplineNode[],
    beforeWidth: number, afterWidth: number,
    inserted: { index: number; count: number } | null) => {
    if (visited.has(sourceId)) return;
    visited.add(sourceId);
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      if (layers[layerIndex].kind !== "path") continue;
      for (let pathIndex = 0; pathIndex < (layers[layerIndex] as PathLayer).paths.length; pathIndex++) {
        const layer = layers[layerIndex] as PathLayer;
        const child = layer.paths[pathIndex];
        if (child.branchFrom?.pathId !== sourceId || child.geometry.type !== "spline") continue;
        const oldIndex = child.branchFrom.nodeIndex;
        const newIndex = oldIndex + (inserted && oldIndex >= inserted.index ? inserted.count : 0);
        const oldAnchor = before[oldIndex], newAnchor = after[newIndex];
        let nextChild: MapPath;
        if (!oldAnchor || !newAnchor) {
          const { branchFrom: _branchFrom, ...detached } = child;
          nextChild = detached;
        } else {
          const original = child.geometry.nodes;
          const first = original[0];
          const dx = newAnchor.position.x - first.position.x;
          const dy = newAnchor.position.y - first.position.y;
          const shift = (point: { x: number; y: number }) => ({ x: point.x + dx, y: point.y + dy });
          const effectiveWidth = newAnchor.width ?? afterWidth;
          const oldEffectiveWidth = oldAnchor.width ?? beforeWidth;
          const nextFirst = dx || dy || effectiveWidth !== oldEffectiveWidth
            ? { ...first, position: { ...newAnchor.position },
              ...(first.in ? { in: shift(first.in) } : {}),
              ...(first.out ? { out: shift(first.out) } : {}), width: effectiveWidth }
            : first;
          nextChild = { ...child, branchFrom: { pathId: sourceId, nodeIndex: newIndex },
            geometry: { type: "spline", nodes: [nextFirst, ...original.slice(1)] } };
        }
        const updatedLayer = { ...layer, paths: layer.paths.map((path, index) =>
          index === pathIndex ? nextChild : path) };
        layers = layers.map((item, index) => index === layerIndex ? updatedLayer : item);
        if (nextChild.geometry.type === "spline")
          follow(child.id, child.geometry.nodes, nextChild.geometry.nodes,
            child.width, nextChild.width, null);
      }
    }
  };
  follow(parentId, oldNodes, newNodes, oldWidth, newWidth, insertion);
  return layers === doc.layers ? doc : { ...doc, layers };
}

export function updateSplinePath(doc: MapDocumentV5, pathId: string,
  patch: { width?: number; nodes?: SplinePathSpec["nodes"]; prependCount?: number;
    insertedAt?: { index: number; count: number } }): MutationResult {
  const found = resolvePath(doc, pathId);
  if ("error" in found) return found.error;
  if (found.path.geometry.type !== "spline" ||
      (found.path.kind !== "road" && found.path.kind !== "river")) {
    return mutationError("path.not-editable-free-line", "pathId", "expected a road or river spline");
  }
  const originalNodes = found.path.geometry.nodes;
  const width = patch.width ?? found.path.width;
  const nodes = patch.nodes ?? originalNodes;
  if (!Number.isFinite(width) || width <= 0)
    return mutationError("path.bad-width", "patch.width", "width must be > 0");
  if (!validSplineNodes(nodes))
    return mutationError("path.bad-nodes", "patch.nodes", "spline needs at least two finite nodes and handles");
  const prependCount = patch.prependCount ?? 0;
  if (!Number.isInteger(prependCount) || prependCount < 0 || prependCount > Math.max(0, nodes.length - originalNodes.length))
    return mutationError("path.bad-prepend", "patch.prependCount", "invalid number of prepended nodes");
  const insertion = patch.insertedAt ?? (prependCount ? { index: 0, count: prependCount } : null);
  if ((patch.insertedAt !== undefined && prependCount > 0) || (insertion !== null &&
      (!Number.isInteger(insertion.index) || insertion.index < 0 || insertion.index > originalNodes.length ||
       !Number.isInteger(insertion.count) || insertion.count < 1 ||
       insertion.count > nodes.length - originalNodes.length)))
    return mutationError("path.bad-insertion", "patch.insertedAt", "invalid inserted node range");
  if (!nodes.some((node) => Math.hypot(node.position.x - nodes[0].position.x,
    node.position.y - nodes[0].position.y) > 1e-6))
    return mutationError("path.zero-length", "patch.nodes", "free path needs two distinct points");
  if (width === found.path.width && nodes.length === originalNodes.length &&
      nodes.every((node, index) => samePoint(node.position, originalNodes[index].position) &&
        samePoint(node.in, originalNodes[index].in) && samePoint(node.out, originalNodes[index].out) &&
        node.width === originalNodes[index].width))
    return noChange(doc);
  const nextNodes = copySplineNodes(nodes);
  const next: MapPath = { ...found.path, width,
    geometry: { type: "spline", nodes: nextNodes } };
  if (next.branchFrom) {
    const parent = resolvePath(doc, next.branchFrom.pathId);
    if ("error" in parent || parent.path.geometry.type !== "spline" ||
      !samePoint(parent.path.geometry.nodes[next.branchFrom.nodeIndex]?.position,
        nextNodes[0].position)) delete next.branchFrom;
  }
  const paths = found.layer.paths.map((path, index) => index === found.pathIndex ? next : path);
  const updated = withPaths(doc, found.layerIndex, found.layer, paths);
  if (!updated.ok) return updated;
  return changed(syncAttachedBranches(updated.document, pathId, originalNodes,
    nextNodes, found.path.width, width, insertion));
}
