// Label CRUD по stable EntityId: create / update text / move / delete.
// Position — всегда world coordinate, без возврата к cell x/y.

import type { EntityId, LabelLayer, MapDocumentV5, MapLabel, Vec2 } from "../types";
import {
  changed,
  collectIds,
  findLayer,
  isFiniteVec,
  noChange,
  withReplacedLayer,
  mutationError,
  type MutationResult,
} from "./helpers";

interface ResolvedLabel {
  layerIndex: number;
  layer: LabelLayer;
  itemIndex: number;
  label: MapLabel;
}

function resolveLabel(doc: MapDocumentV5, id: string): ResolvedLabel | { error: MutationResult } {
  for (let li = 0; li < doc.layers.length; li++) {
    const layer = doc.layers[li];
    if (layer.kind !== "label") continue;
    const ii = layer.items.findIndex((l) => l.id === id);
    if (ii !== -1) return { layerIndex: li, layer, itemIndex: ii, label: layer.items[ii] };
  }
  return {
    error: mutationError("label.unknown-id", "id", `label "${id}" does not exist`),
  };
}

function resolveLabelLayer(
  doc: MapDocumentV5,
  layerId: string,
): { index: number; layer: LabelLayer } | { error: MutationResult } {
  const found = findLayer(doc, layerId);
  if (!found) {
    return {
      error: mutationError("label.unknown-layer", "layerId", `layer "${layerId}" does not exist`),
    };
  }
  if (found.layer.kind !== "label") {
    return {
      error: mutationError(
        "label.wrong-layer-kind",
        "layerId",
        `layer "${layerId}" is ${found.layer.kind}, not label`,
      ),
    };
  }
  return { index: found.index, layer: found.layer };
}

export interface LabelSpec {
  id: EntityId;
  position: Vec2;
  text: string;
  styleRef?: string;
}

export function createLabel(doc: MapDocumentV5, layerId: string, spec: LabelSpec): MutationResult {
  const resolved = resolveLabelLayer(doc, layerId);
  if ("error" in resolved) return resolved.error;
  if (typeof spec.id !== "string" || spec.id.length === 0) {
    return mutationError("label.bad-id", "spec.id", "label id must be a non-empty string");
  }
  if (collectIds(doc).has(spec.id)) {
    return mutationError(
      "label.duplicate-id",
      "spec.id",
      `id "${spec.id}" already exists anywhere in document`,
    );
  }
  if (!isFiniteVec(spec.position)) {
    return mutationError("label.bad-position", "spec.position", "position must be finite { x, y }");
  }
  if (typeof spec.text !== "string" || spec.text.trim().length === 0) {
    return mutationError("label.bad-text", "spec.text", "text must be a non-empty string");
  }
  if (spec.styleRef !== undefined && typeof spec.styleRef !== "string") {
    return mutationError("label.bad-style-ref", "spec.styleRef", "styleRef must be a string");
  }
  const label: MapLabel = {
    id: spec.id,
    position: { x: spec.position.x, y: spec.position.y },
    text: spec.text,
  };
  if (spec.styleRef !== undefined) label.styleRef = spec.styleRef;
  const items = [...resolved.layer.items, label];
  const result = changed(withReplacedLayer(doc, resolved.index, { ...resolved.layer, items }));
  if (result.ok) return { ...result, entityId: spec.id };
  return result;
}

export function updateLabelText(doc: MapDocumentV5, id: string, text: string): MutationResult {
  const resolved = resolveLabel(doc, id);
  if ("error" in resolved) return resolved.error;
  if (typeof text !== "string" || text.trim().length === 0) {
    return mutationError("label.bad-text", "text", "text must be a non-empty string");
  }
  if (resolved.label.text === text) return noChange(doc);
  const items = [...resolved.layer.items];
  items[resolved.itemIndex] = { ...resolved.label, text };
  return changed(withReplacedLayer(doc, resolved.layerIndex, { ...resolved.layer, items }));
}

export function moveLabel(doc: MapDocumentV5, id: string, delta: Vec2): MutationResult {
  const resolved = resolveLabel(doc, id);
  if ("error" in resolved) return resolved.error;
  if (!isFiniteVec(delta)) {
    return mutationError("label.bad-delta", "delta", "delta must be finite { x, y }");
  }
  if (delta.x === 0 && delta.y === 0) return noChange(doc);
  const items = [...resolved.layer.items];
  items[resolved.itemIndex] = {
    ...resolved.label,
    position: {
      x: resolved.label.position.x + delta.x,
      y: resolved.label.position.y + delta.y,
    },
  };
  return changed(withReplacedLayer(doc, resolved.layerIndex, { ...resolved.layer, items }));
}

/** Удалить подпись; отсутствующая → no-op. */
export function deleteLabel(doc: MapDocumentV5, id: string): MutationResult {
  const resolved = resolveLabel(doc, id);
  if ("error" in resolved) return noChange(doc);
  const items = resolved.layer.items.filter((_, i) => i !== resolved.itemIndex);
  return changed(withReplacedLayer(doc, resolved.layerIndex, { ...resolved.layer, items }));
}
