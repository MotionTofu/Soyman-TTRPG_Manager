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

/** Предел размера предмета (П15): не больше карты, но не меньше прежних 8 единиц. */
export const maxObjectSize = (doc: Pick<MapDocumentV5, "world">) =>
  Math.max(8, doc.world.bounds.maxX - doc.world.bounds.minX, doc.world.bounds.maxY - doc.world.bounds.minY);

export function transformMapObject(doc: MapDocumentV5, id: string, rotation: number, size: number, flipX?: boolean, flipY?: boolean): MutationResult {
  if (!Number.isFinite(rotation) || !Number.isFinite(size) || size < 0.25 || size > maxObjectSize(doc))
    return mutationError("object.bad-transform", "transform", "rotation must be finite and size 0.25..map size");
  for (let i = 0; i < doc.layers.length; i++) {
    const layer = doc.layers[i];
    if (layer.kind !== "object") continue;
    const index = layer.items.findIndex((item) => item.id === id);
    if (index < 0) continue;
    const item = layer.items[index];
    const sx = size * ((flipX ?? item.transform.scale.x < 0) ? -1 : 1);
    const sy = size * ((flipY ?? item.transform.scale.y < 0) ? -1 : 1);
    if (item.transform.rotation === rotation && item.transform.scale.x === sx && item.transform.scale.y === sy)
      return noChange(doc);
    const items = [...layer.items];
    items[index] = { ...item, transform: { ...item.transform, rotation, scale: { x: sx, y: sy } } };
    return changed(withReplacedLayer(doc, i, { ...layer, items }));
  }
  return mutationError("object.not-found", "id", "object not found");
}

/** «Не трогать воду» (гриллинг 2026-10-15, В7): вода не рисует вокруг объекта пену и след — навес, мост-объект, кувшинка. */
export function setMapObjectDry(doc: MapDocumentV5, id: string, dry: boolean): MutationResult {
  for (let i = 0; i < doc.layers.length; i++) {
    const layer = doc.layers[i];
    if (layer.kind !== "object") continue;
    const index = layer.items.findIndex((item) => item.id === id);
    if (index < 0) continue;
    const item = layer.items[index];
    if (item.properties?.dry === dry) return noChange(doc);
    // Значение хранится явно: у вещей, лежащих на воде, «не трогать» стоит по умолчанию, и снять его — тоже выбор.
    const items = [...layer.items];
    items[index] = { ...item, properties: { ...item.properties, dry } };
    return changed(withReplacedLayer(doc, i, { ...layer, items }));
  }
  return mutationError("object.not-found", "id", "object not found");
}

/** Знак «Мира» (М13): название, своя высота букв подписи и локация мира — в `properties`. Пустое значение убирает поле. */
export function setMapObjectSign(doc: MapDocumentV5, id: string, patch: { name?: string; labelSize?: number; location?: string }): MutationResult {
  for (let i = 0; i < doc.layers.length; i++) {
    const layer = doc.layers[i];
    if (layer.kind !== "object") continue;
    const index = layer.items.findIndex((item) => item.id === id);
    if (index < 0) continue;
    const { properties: before, ...item } = layer.items[index], properties = { ...before };
    for (const [key, value] of Object.entries(patch)) if (value === undefined || value === "") delete properties[key]; else properties[key] = value;
    if (JSON.stringify(properties) === JSON.stringify(before ?? {})) return noChange(doc);
    const items = [...layer.items];
    items[index] = Object.keys(properties).length ? { ...item, properties } : item;
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
