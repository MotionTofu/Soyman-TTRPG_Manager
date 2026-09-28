import type { MapDocumentV5, MapObject, Vec2 } from "../types";
import { collectIds, findLayer, withReplacedLayer } from "./helpers";
import { changed, mutationError, noChange, type MutationResult } from "./types";
import { validateMapDocument } from "../validate";

export function addMapObject(doc: MapDocumentV5, layerId: string, object: MapObject): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found || found.layer.kind !== "object") return mutationError("object.bad-layer", "layerId", "object layer not found");
  if (collectIds(doc).has(object.id)) return mutationError("object.duplicate-id", "object.id", "object id already exists");
  if (!Number.isFinite(object.transform.position.x) || !Number.isFinite(object.transform.position.y))
    return mutationError("object.bad-position", "object.transform.position", "position must be finite");
  const next = withReplacedLayer(doc, found.index, { ...found.layer, items: [...found.layer.items, object] });
  const issue = validateMapDocument(next)[0];
  return issue ? mutationError(issue.code, issue.path, issue.message) : changed(next);
}

export function moveMapObject(doc: MapDocumentV5, id: string, position: Vec2): MutationResult {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y))
    return mutationError("object.bad-position", "position", "position must be finite");
  for (let i = 0; i < doc.layers.length; i++) {
    const layer = doc.layers[i];
    if (layer.kind !== "object") continue;
    const index = layer.items.findIndex((item) => item.id === id);
    if (index < 0) continue;
    const item = layer.items[index];
    if (item.transform.position.x === position.x && item.transform.position.y === position.y) return noChange(doc);
    const items = [...layer.items];
    items[index] = { ...item, transform: { ...item.transform, position } };
    return changed(withReplacedLayer(doc, i, { ...layer, items }));
  }
  return mutationError("object.not-found", "id", "object not found");
}

export function transformMapObject(doc: MapDocumentV5, id: string, rotation: number, size: number): MutationResult {
  if (!Number.isFinite(rotation) || !Number.isFinite(size) || size < 0.25 || size > 8)
    return mutationError("object.bad-transform", "transform", "rotation must be finite and size 0.25..8");
  for (let i = 0; i < doc.layers.length; i++) {
    const layer = doc.layers[i];
    if (layer.kind !== "object") continue;
    const index = layer.items.findIndex((item) => item.id === id);
    if (index < 0) continue;
    const item = layer.items[index];
    if (item.transform.rotation === rotation && item.transform.scale.x === size && item.transform.scale.y === size)
      return noChange(doc);
    const items = [...layer.items];
    items[index] = { ...item, transform: { ...item.transform, rotation, scale: { x: size, y: size } } };
    return changed(withReplacedLayer(doc, i, { ...layer, items }));
  }
  return mutationError("object.not-found", "id", "object not found");
}

export function deleteMapObject(doc: MapDocumentV5, id: string): MutationResult {
  for (let i = 0; i < doc.layers.length; i++) {
    const layer = doc.layers[i];
    if (layer.kind !== "object") continue;
    const index = layer.items.findIndex((item) => item.id === id);
    if (index < 0) continue;
    return changed(withReplacedLayer(doc, i, { ...layer, items: layer.items.filter((item) => item.id !== id) }));
  }
  return mutationError("object.not-found", "id", "object not found");
}
