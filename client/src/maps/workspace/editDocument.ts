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
  const result = operation(geometryView(document));
  if (!result.ok) throw new Error("Не удалось применить изменение к этому слою");
  if (!result.changed) return document;
  for (const layer of document.layers) {
    if (layer.kind === "gameplay" && layer.items.some((item) => item.kind === "token") &&
      !result.document.layers.some((next) => next.id === layer.id && next.kind === "gameplay")) {
      throw new Error("Слой содержит связанные токены");
    }
  }
  const next: MapDocumentV6 = { ...result.document, v: 6, layers: result.document.layers.map((layer) => {
    const original = document.layers.find((entry) => entry.id === layer.id);
    if (layer.kind !== "gameplay" || original?.kind !== "gameplay") return layer;
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
  return canonicalizeMapDocumentV6(next);
}
