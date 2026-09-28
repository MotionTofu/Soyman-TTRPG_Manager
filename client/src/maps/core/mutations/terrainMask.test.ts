import { describe, expect, it } from "vitest";
import { validateMapDocument } from "../validate";
import { assessCurrentEditorCompatibility } from "../compatibility";
import { parseMapDocument } from "../parse";
import { serializeMapDocument } from "../serialize";
import type { MapDocumentV5 } from "../types";
import { createV5RenderModel } from "../../renderModel";
import { createTerrainMaskLayer } from "./layers";
import { floodTerrainMask, paintTerrainMask, readTerrainMaskAt } from "./terrainMask";

function emptyMap(): MapDocumentV5 {
  return {
    v: 5, world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
    grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } },
    assetPacks: [], layers: [],
  };
}

describe("dense terrain mask", () => {
  it("fills only the connected sample region and can erase it", () => {
    const created = createTerrainMaskLayer(emptyMap(), { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    let doc = created.document;
    let nextId = 0;
    const newId = () => `chunk-${++nextId}`;
    const wall = { type: "builtin" as const, key: "terrain/wall" };
    const forest = { type: "builtin" as const, key: "terrain/forest" };
    for (let sy = 0; sy < 32; sy++) {
      const dab = paintTerrainMask(doc, "mask", 4.125, (sy + 0.5) * 0.25, 0, wall, newId);
      if (!dab.ok) throw new Error("fixture failed");
      doc = dab.document;
    }
    const filled = floodTerrainMask(doc, "mask", 1, 1, forest, newId);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(readTerrainMaskAt(filled.document, "mask", 1, 1)).toEqual(forest);
    expect(readTerrainMaskAt(filled.document, "mask", 4.125, 1)).toEqual(wall);
    expect(readTerrainMaskAt(filled.document, "mask", 7, 1)).toEqual({ type: "builtin", key: "terrain/plain" });
    expect(validateMapDocument(filled.document)).toEqual([]);
    const again = floodTerrainMask(filled.document, "mask", 1, 1, forest, newId);
    expect(again.ok && again.changed).toBe(false);
    const erased = floodTerrainMask(filled.document, "mask", 1, 1, null, newId);
    expect(erased.ok).toBe(true);
    if (erased.ok) expect(readTerrainMaskAt(erased.document, "mask", 1, 1)).toEqual({ type: "builtin", key: "terrain/plain" });
  });

  it("distinguishes an opaque plain sample from transparent zero", () => {
    const created = createTerrainMaskLayer(emptyMap(), { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    const plain = { type: "builtin" as const, key: "terrain/plain" };
    const painted = paintTerrainMask(created.document, "mask", 1.25, 1.25, 0.2, plain, () => "plain-chunk");
    expect(painted.ok).toBe(true);
    if (!painted.ok) return;
    const model = createV5RenderModel(painted.document).model.layers[0];
    expect(model.kind === "terrain" ? [...(model.terrain.mask?.entries.values() ?? [])] : []).toContain("plain");
    const erased = paintTerrainMask(painted.document, "mask", 1.25, 1.25, 0.2, null, () => "unused");
    expect(erased.ok).toBe(true);
    if (erased.ok) {
      const layer = erased.document.layers[0];
      expect(layer.kind === "terrain" && layer.representation === "mask" ? layer.mask.chunks : null).toEqual([]);
    }
  });

  it("keeps a full 100×100 map mask under the map API body limit", () => {
    const doc = emptyMap();
    doc.world.bounds.maxX = 100;
    doc.world.bounds.maxY = 100;
    if (!doc.grid) throw new Error("fixture failed");
    doc.grid.columns = 100;
    doc.grid.rows = 100;
    const created = createTerrainMaskLayer(doc, { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    let chunk = 0;
    const filled = floodTerrainMask(created.document, "mask", 50, 50,
      { type: "builtin", key: "terrain/forest" }, () => `mask-${String(++chunk).padStart(31, "0")}`);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(chunk).toBe(625);
    expect(serializeMapDocument(filled.document).length).toBeLessThan(1_000_000);
    expect(validateMapDocument(filled.document)).toEqual([]);
  });
  it("creates, paints, saves, reads, renders and erases quarter-cell samples", () => {
    const created = createTerrainMaskLayer(emptyMap(), { id: "mask", name: "Детальный рельеф" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const forest = { type: "builtin" as const, key: "terrain/forest" };
    let nextId = 0;
    const painted = paintTerrainMask(created.document, "mask", 1.25, 1.25, 0.2, forest, () => `chunk-${++nextId}`);
    expect(painted.ok).toBe(true);
    if (!painted.ok) return;
    expect(painted.changed).toBe(true);
    expect(validateMapDocument(painted.document)).toEqual([]);
    expect(readTerrainMaskAt(painted.document, "mask", 1.25, 1.25)).toEqual(forest);
    expect(readTerrainMaskAt(painted.document, "mask", 7, 7)).toEqual({ type: "builtin", key: "terrain/plain" });
    expect(assessCurrentEditorCompatibility(painted.document).compatible).toBe(true);
    const model = createV5RenderModel(painted.document);
    expect(model.diagnostics).toEqual([]);
    expect(model.model.layers[0].kind).toBe("terrain");
    if (model.model.layers[0].kind === "terrain") expect(model.model.layers[0].terrain.mask?.entries.size).toBeGreaterThan(0);

    const parsed = parseMapDocument(JSON.parse(serializeMapDocument(painted.document)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(readTerrainMaskAt(parsed.value, "mask", 1.25, 1.25)).toEqual(forest);
    const repeat = paintTerrainMask(parsed.value, "mask", 1.25, 1.25, 0.2, forest, () => "unused");
    expect(repeat.ok && repeat.changed).toBe(false);
    const erased = paintTerrainMask(parsed.value, "mask", 1.25, 1.25, 0.2, null, () => "unused");
    expect(erased.ok).toBe(true);
    if (!erased.ok) return;
    expect(readTerrainMaskAt(erased.document, "mask", 1.25, 1.25)).toEqual({ type: "builtin", key: "terrain/plain" });
    const layer = erased.document.layers[0];
    expect(layer.kind === "terrain" && layer.representation === "mask" ? layer.mask.chunks : null).toEqual([]);
  });

  it("rejects malformed indexes and keeps unknown future encodings behind compatibility", () => {
    const created = createTerrainMaskLayer(emptyMap(), { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    const layer = created.document.layers[0];
    if (layer.kind !== "terrain" || layer.representation !== "mask") throw new Error("fixture failed");
    const future: MapDocumentV5 = { ...created.document, layers: [{ ...layer, mask: {
      ...layer.mask, chunks: [{ id: "future", cx: 0, cy: 0, payload: { encoding: "future-v2" } }],
    } }] };
    expect(validateMapDocument(future)).toEqual([]);
    expect(assessCurrentEditorCompatibility(future).reasons.map((r) => r.code)).toContain("unsupported-terrain-mask");
    expect(paintTerrainMask(future, "mask", 1, 1, 0.2, null, () => "new").ok).toBe(false);
    const malformed: MapDocumentV5 = { ...future, layers: [{ ...layer, mask: {
      ...layer.mask, chunks: [{ id: "bad", cx: 0, cy: 0, payload: { encoding: "palette-index-v1", values: [99] } }],
    } }] };
    expect(validateMapDocument(malformed).map((issue) => issue.code)).toContain("terrain.mask.bad-index-payload");
  });
});
