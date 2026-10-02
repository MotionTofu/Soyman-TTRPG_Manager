import { describe, expect, it } from "vitest";
import { serializeMapDocumentV6, validateMapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { createTerrainMaskLayer } from "../core/mutations/layers";
import { editGeometry } from "./editDocument";
import { paintSurface, paintSurfaceStroke } from "./artisticCommands";
import { createWorkspaceRenderModel } from "./renderV6";
import { terrainMaskTiles } from "../terrainMaskTiles";
function fixture() {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 40, height: 40, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  return editGeometry(loaded.document, d => createTerrainMaskLayer(d, { id: "mask", name: "Surface" }));
}
describe("surface stroke", () => {
  it("preserves unchanged chunk/tile identity after validation and canonicalization", () => {
    let before = paintSurfaceStroke(fixture(), "mask", [{ x: 1, y: 1 }], .3, "earth");
    before = paintSurface(before, "mask", { x: 30, y: 30 }, { x: 30, y: 30 }, .3, "earth");
    const serialized = serializeMapDocumentV6(before);
    const after = paintSurface(before, "mask", { x: 1, y: 1 }, { x: 2, y: 1 }, .3, "earth");
    const getMask = (d: typeof before) => { const l = d.layers.find(l => l.id === "mask"); if (l?.kind !== "terrain" || l.representation !== "mask") throw Error("fixture"); return l.mask; };
    expect(getMask(after).chunks.find(c => c.cx === 7 && c.cy === 7)).toBe(getMask(before).chunks.find(c => c.cx === 7 && c.cy === 7));
    const palette = { plain: "#ffffff", earth: "#5d5040" }, bounds = { minX: 0, minY: 0, maxX: 40, maxY: 40 };
    const tile = (d: typeof before) => { const l = createWorkspaceRenderModel(d).model.layers.find(l => l.id === "mask"); if (l?.kind !== "terrain" || !l.terrain.mask) throw Error("fixture"); return terrainMaskTiles(l.terrain.mask, 40, 40, palette, bounds).find(t => t.cx === 7 && t.cy === 7); };
    expect(tile(after)).toBe(tile(before));
    for (const layer of before.layers) if (layer.id !== "mask") expect(after.layers.find(next => next.id === layer.id)).toBe(layer);
    expect(validateMapDocumentV6(after)).toEqual([]);
    expect(serializeMapDocumentV6(before)).toBe(serialized);
  });
  it("keeps a sharply turning pointer path continuous and erases exactly that stroke", () => {
    const initial = fixture(), points = [{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 6 }];
    const painted = paintSurfaceStroke(initial, "mask", points, .3, "earth");
    const layer = painted.layers.find(l => l.id === "mask"); if (layer?.kind !== "terrain" || layer.representation !== "mask") throw Error("fixture");
    const samples = new Set(layer.mask.chunks.flatMap(c => { const values = c.payload.values as number[]; return values.flatMap((v, i) => v ? [`${c.cx * 16 + i % 16},${c.cy * 16 + Math.floor(i / 16)}`] : []); }));
    expect(samples.has("14,4")).toBe(true); expect(samples.has("24,14")).toBe(true); expect(samples.has("14,14")).toBe(false);
    const erased = paintSurfaceStroke(painted, "mask", points, .3, null);
    expect(serializeMapDocumentV6(erased)).toBe(serializeMapDocumentV6({ ...initial, layers: initial.layers.map(l => l.id === "mask" && l.kind === "terrain" && l.representation === "mask" ? { ...l, mask: { ...l.mask, materials: layer.mask.materials } } : l) }));
  });
});
