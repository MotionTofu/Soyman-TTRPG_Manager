import { canonicalizeMapDocumentV6, validateMapDocumentV6, type MapDocumentV6 } from "@shared/maps/core";
import type { MapDocumentV5, GameplayEntity } from "../core/types";
import type { MutationResult } from "../core/mutations/types";

/** Geometry-only view. Never serialize it or put it into history. */
export function geometryView(document: MapDocumentV6): MapDocumentV5 {
  return { ...document, v: 5, layers: document.layers.map((layer) => layer.kind === "gameplay"
    ? { ...layer, items: layer.items.filter((item): item is GameplayEntity => item.kind !== "token") } : layer) };
}

/** Apply a checked V5 operation without dropping tokens or their item order.
 * Layer removal with tokens is deliberately outside this adapter. */
export function editGeometry(document: MapDocumentV6, operation: (view: MapDocumentV5) => MutationResult): MapDocumentV6 {
  const view = geometryView(document), result = operation(view);
  if (!result.ok) throw new Error("Не удалось применить изменение к этому слою");
  if (!result.changed) return document;
  for (const layer of document.layers) {
    if (layer.kind === "gameplay" && layer.items.some((item) => item.kind === "token") &&
      !result.document.layers.some((next) => next.id === layer.id && next.kind === "gameplay")) {
      throw new Error("Слой содержит связанные токены");
    }
  }
  const next: MapDocumentV6 = { ...result.document, v: 6, ...(document.appearance ? { appearance: document.appearance } : {}), layers: result.document.layers.map((layer) => {
    const original = document.layers.find((entry) => entry.id === layer.id);
    if (layer.kind !== "gameplay" || original?.kind !== "gameplay") return layer;
    if (view.layers.find(entry => entry.id === layer.id) === layer) return original;
    const items = [...layer.items] as typeof original.items;
    // Insert before the next surviving old item. This also preserves consecutive
    // tokens when the item on their left was removed by the geometry operation.
    for (let i = 0; i < original.items.length; i++) {
      const token = original.items[i];
      if (token.kind !== "token") continue;
      const anchor = original.items.slice(i + 1).find((item) => item.kind !== "token" && items.some((nextItem) => nextItem.id === item.id));
      const previous = original.items.slice(0, i).reverse().find((item) => items.some((nextItem) => nextItem.id === item.id));
      const index = anchor ? items.findIndex((item) => item.id === anchor.id)
        : previous ? items.findIndex((item) => item.id === previous.id) + 1 : 0;
      items.splice(index, 0, token);
    }
    return { ...layer, items };
  }) };
  if (validateMapDocumentV6(next).length) throw new Error("Изменение нарушает целостность карты");
  // Core mutations keep untouched layers by identity. Canonicalize only changed
  // layers so painting does not regenerate a forest or copy every object.
  const untouched = new Map(document.layers.map(layer => [layer.id, layer]));
  const canonical = canonicalizeMapDocumentV6({ ...next, layers: next.layers.filter(layer => untouched.get(layer.id) !== layer) });
  const changed = new Map(canonical.layers.map(layer => [layer.id, layer]));
  return { ...canonical, layers: next.layers.map(layer => {
    const normalized = changed.get(layer.id) ?? layer;
    const original = untouched.get(layer.id);
    if (normalized.kind !== "terrain" || normalized.representation !== "mask" || layer.kind !== "terrain" || layer.representation !== "mask" ||
      original?.kind !== "terrain" || original.representation !== "mask") return normalized;
    // Validation/normalization still runs. Reuse already-canonical untouched
    // chunks afterwards so a local brush edit does not invalidate every tile.
    const oldChunks = new Map(original.mask.chunks.map(chunk => [chunk.id, chunk]));
    const rawChunks = new Map(layer.mask.chunks.map(chunk => [chunk.id, chunk]));
    return { ...normalized, mask: { ...normalized.mask, chunks: normalized.mask.chunks.map(chunk => {
      const old = oldChunks.get(chunk.id);
      return old && rawChunks.get(chunk.id) === old ? old : chunk;
    }) } };
  }) };
}
