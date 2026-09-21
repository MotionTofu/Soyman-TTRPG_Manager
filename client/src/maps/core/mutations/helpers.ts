// Внутренние helpers mutations (не публичный API).
// Иммутабельность: слои/массивы/сущности клонируются только на пути
// изменения; нетронутое переиспользуется по reference (structural sharing).

import type {
  EntityId,
  GameplayEntity,
  MapDocumentV5,
  MapLabel,
  MapLayer,
  MapObject,
  MapPath,
  ScatterArea,
} from "../types";
import { changed, mutationError, noChange, type MutationIssue, type MutationResult } from "./types";

export { changed, mutationError, noChange };
export type { MutationIssue, MutationResult };

export function findLayer(
  doc: MapDocumentV5,
  layerId: string,
): { index: number; layer: MapLayer } | undefined {
  const index = doc.layers.findIndex((l) => l.id === layerId);
  if (index === -1) return undefined;
  return { index, layer: doc.layers[index] };
}

/** Все ID документа (слои + все сущности): global uniqueness invariant. */
export function collectIds(doc: MapDocumentV5): Set<string> {
  const ids = new Set<string>();
  const add = (id: string) => {
    ids.add(id);
  };
  for (const layer of doc.layers) {
    add(layer.id);
    if (layer.kind === "terrain" && layer.representation === "mask") {
      for (const c of layer.mask.chunks) add(c.id);
    } else if (layer.kind === "path") {
      for (const p of layer.paths) add(p.id);
    } else if (layer.kind === "object") {
      for (const o of layer.items) add(o.id);
    } else if (layer.kind === "scatter") {
      for (const a of layer.areas) add(a.id);
    } else if (layer.kind === "label") {
      for (const l of layer.items) add(l.id);
    } else if (layer.kind === "gameplay") {
      for (const e of layer.items) add(e.id);
    }
  }
  return ids;
}

export function withReplacedLayer(
  doc: MapDocumentV5,
  index: number,
  layer: MapLayer,
): MapDocumentV5 {
  const layers = [...doc.layers];
  layers[index] = layer;
  return { ...doc, layers };
}

export function isFiniteVec(v: unknown): v is { x: number; y: number } {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.x === "number" &&
    Number.isFinite(p.x) &&
    typeof p.y === "number" &&
    Number.isFinite(p.y)
  );
}

export type { EntityId, GameplayEntity, MapLabel, MapObject, MapPath, ScatterArea };
