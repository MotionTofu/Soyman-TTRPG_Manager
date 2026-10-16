// Подложка для обрисовки (гриллинг 2026-10-16, П1–П16): слой картинок, которые видит только Мастер.
import type { MapDocumentV5, ReferenceImage, ReferenceLayer } from "../types";
import { collectIds, findLayer, withReplacedLayer } from "./helpers";
import { changed, mutationError, noChange, type MutationResult } from "./types";
import { validateMapDocument } from "../validate";
import type { LayerSpec } from "./layers";

const checked = (next: MapDocumentV5): MutationResult => {
  const issue = validateMapDocument(next)[0];
  return issue ? mutationError(issue.code, issue.path, issue.message) : changed(next);
};

/** Новый слой подложки — наверху списка, чтобы обводить поверх карты (П12). */
export function createReferenceLayer(doc: MapDocumentV5, spec: LayerSpec): MutationResult {
  if (typeof spec.id !== "string" || !spec.id || collectIds(doc).has(spec.id)) return mutationError("layer.bad-id", "spec.id", "layer id must be new");
  if (!spec.name.trim()) return mutationError("layer.bad-name", "name", "layer name must be a non-empty string");
  const layer: ReferenceLayer = { id: spec.id, name: spec.name, visible: true, locked: false, opacity: 0.5, kind: "reference", items: [] };
  return changed({ ...doc, layers: [...doc.layers, layer] });
}

export function addReferenceImage(doc: MapDocumentV5, layerId: string, image: ReferenceImage): MutationResult {
  const found = findLayer(doc, layerId);
  if (!found || found.layer.kind !== "reference") return mutationError("reference.bad-layer", "layerId", "reference layer not found");
  if (collectIds(doc).has(image.id)) return mutationError("reference.duplicate-id", "image.id", "id already exists");
  return checked(withReplacedLayer(doc, found.index, { ...found.layer, items: [...found.layer.items, image] }));
}

function locate(doc: MapDocumentV5, id: string) {
  for (let i = 0; i < doc.layers.length; i++) {
    const layer = doc.layers[i];
    if (layer.kind !== "reference") continue;
    const index = layer.items.findIndex((item) => item.id === id);
    if (index >= 0) return { i, layer, index };
  }
  return null;
}

export type ReferencePatch = Partial<Pick<ReferenceImage, "position" | "width" | "rotation" | "opacity">> & { crop?: ReferenceImage["crop"] | null };

/** Сдвиг, размер, поворот, прозрачность, обрезка (`crop: null` — снять обрезку). */
export function updateReferenceImage(doc: MapDocumentV5, id: string, patch: ReferencePatch): MutationResult {
  const found = locate(doc, id);
  if (!found) return mutationError("reference.not-found", "id", "reference image not found");
  const item = found.layer.items[found.index];
  const { crop, ...rest } = patch;
  const next: ReferenceImage = { ...item, ...rest };
  if (crop === null) delete next.crop; else if (crop) next.crop = crop;
  if (JSON.stringify(next) === JSON.stringify(item)) return noChange(doc);
  const items = [...found.layer.items];
  items[found.index] = next;
  return checked(withReplacedLayer(doc, found.i, { ...found.layer, items }));
}

export function deleteReferenceImage(doc: MapDocumentV5, id: string): MutationResult {
  const found = locate(doc, id);
  if (!found) return mutationError("reference.not-found", "id", "reference image not found");
  return changed(withReplacedLayer(doc, found.i, { ...found.layer, items: found.layer.items.filter((item) => item.id !== id) }));
}

/** Порядок кусков коллажа: +1 — выше (рисуется позже), −1 — ниже (П16). */
export function shiftReferenceImage(doc: MapDocumentV5, id: string, step: 1 | -1): MutationResult {
  const found = locate(doc, id);
  if (!found) return mutationError("reference.not-found", "id", "reference image not found");
  const to = found.index + step;
  if (to < 0 || to >= found.layer.items.length) return noChange(doc);
  const items = [...found.layer.items];
  [items[found.index], items[to]] = [items[to], items[found.index]];
  return changed(withReplacedLayer(doc, found.i, { ...found.layer, items }));
}
