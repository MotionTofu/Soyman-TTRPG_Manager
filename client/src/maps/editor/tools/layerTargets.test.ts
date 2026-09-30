import { describe, expect, it } from "vitest";
import type { MapDocumentV5 } from "../../core/types";
import { ensurePathTargetLayer } from "./layerTargets";

const empty: MapDocumentV5 = {
  v: 5, world: { bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 } },
  grid: { type: "square", cellSize: 1, columns: 4, rows: 4, origin: { x: 0, y: 0 } },
  assetPacks: [], layers: [],
};

describe("ensurePathTargetLayer", () => {
  it("creates a named road layer once when the map has no path layer", () => {
    const created = ensurePathTargetLayer(empty, null, "road", () => "road-layer");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.document.layers).toMatchObject([{ id: "road-layer", name: "Дороги", kind: "path" }]);
    const reused = ensurePathTargetLayer(created.document, created.layerId, "river", () => "unused");
    expect(reused.ok && reused.document).toBe(created.document);
    expect(reused.ok && reused.created).toBe(false);
  });

  it("does not create over a hidden path layer", () => {
    const doc: MapDocumentV5 = { ...empty, layers: [{ id: "hidden", name: "Реки", kind: "path",
      visible: false, locked: false, opacity: 1, paths: [] }] };
    const result = ensurePathTargetLayer(doc, "hidden", "river", () => "new");
    expect(result.ok).toBe(false);
    expect(doc.layers).toHaveLength(1);
  });
});
