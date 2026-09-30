import { describe, it, expect } from "vitest";
import { createGameplayToken, putGameplayToken, parseMapDocumentV6, serializeMapDocumentV6, tokensOf, validateMapDocumentV6 } from "@shared/maps/core";
import { buildDungeonDocument, DUNGEON_PRESETS } from "./dungeonGeneration";
import { editGeometry, geometryView } from "./editDocument";
import { createTerrainMaskLayer, createPathLayer, createScatterLayer, moveLayer } from "../core/mutations/layers";
import { paintSurface, addFreePath, addScatter, selectedPath, editPathNode, putScatter, pathHit } from "./artisticCommands";
import { moveSelection, removeSelection, addSymbol } from "./editorCommands";
import { updateSplinePath } from "../core/mutations/paths";
import { transformMapObject } from "../core/mutations/mapObjects";
import { scatterInstances, shapeContains } from "../scatter";
import { createWorkspaceRenderModel } from "./renderV6";
import { readTerrainMaskAt } from "../core/mutations/terrainMask";

function fixture() {
  let doc = buildDungeonDocument({ ...DUNGEON_PRESETS[0], seed: 10 }, "paper-ink");
  const gp = doc.layers.find(l => l.kind === "gameplay")!;
  doc = putGameplayToken(doc, gp.id, createGameplayToken("token", { kind: "being", uid: "11111111-1111-4111-8111-111111111111" }, { x: 4.5, y: 4.5 }));
  for (const [create, id] of [[createTerrainMaskLayer, "surface"], [createPathLayer, "paths"], [createScatterLayer, "scatter"]] as const)
    doc = editGeometry(doc, view => create(view, { id, name: id }));
  return doc;
}
describe("artistic workspace", () => {
  it("paints continuous masks, erases transparently and clips at map boundaries", () => {
    const before = fixture(), raw = serializeMapDocumentV6(before);
    let next = paintSurface(before, "surface", { x: -2, y: 4 }, { x: 12, y: 4 }, 1, "shallow_water");
    for (let x = 0; x <= 12; x += .25) expect(readTerrainMaskAt(geometryView(next), "surface", x, 4)).toEqual({ type: "builtin", key: "terrain/shallow_water" });
    next = paintSurface(next, "surface", { x: 4, y: 4 }, { x: 4, y: 4 }, 1, null);
    expect(readTerrainMaskAt(geometryView(next), "surface", 4, 4)).toEqual({ type: "builtin", key: "terrain/plain" });
    expect(serializeMapDocumentV6(before)).toBe(raw); expect(tokensOf(next)).toEqual(tokensOf(before));
    const paths = before.layers.find(l => l.id === "paths");
    expect(next.layers.find(l => l.id === "paths")).toBe(paths);
    expect(validateMapDocumentV6(paintSurface(next, "surface", { x: 4, y: 4 }, { x: 4, y: 4 }, 8, "forest"))).toEqual([]);
  });
  it("creates curves and edits anchors/handles/whole lines without losing token identity", () => {
    const doc = addFreePath(fixture(), "paths", [{ x: 2, y: 2 }, { x: 8, y: 5 }, { x: 15, y: 3 }], "river", .5);
    const layer = doc.layers.find(l => l.id === "paths")!; if (layer.kind !== "path") throw Error();
    const selection = { id: layer.paths[0].id, layerId: "paths", kind: "path" as const };
    const next = editPathNode(doc, selection, 1, "position", { x: 9, y: 7 });
    const path = selectedPath(next, selection)!; if (path.geometry.type !== "spline") throw Error();
    expect(path.geometry.nodes[1].position).toEqual({ x: 9, y: 7 });
    expect(pathHit(path.geometry.nodes, { x: 9, y: 7 }, .2)).toBe(true);
    const shorter = editGeometry(next, view => updateSplinePath(view, path.id, { nodes: path.geometry.type === "spline" ? path.geometry.nodes.filter((_, i) => i !== 1) : [] }));
    const shortPath = selectedPath(shorter, selection)!;
    expect(shortPath.geometry.type === "spline" && shortPath.geometry.nodes.length).toBe(2);
    expect(pathHit(path.geometry.nodes, { x: 25, y: 20 }, .2)).toBe(false);
    const handled = editPathNode(next, selection, 1, "out", { x: 13, y: 9 });
    const handledPath = selectedPath(handled, selection)!;
    expect(handledPath.geometry.type === "spline" && handledPath.geometry.nodes[1].out).toEqual({ x: 13, y: 9 });
    const moved = moveSelection(next, selection, { x: 1, y: 2 });
    expect(tokensOf(moved)).toEqual(tokensOf(doc)); expect(validateMapDocumentV6(moved)).toEqual([]);
    expect(selectedPath(removeSelection(moved, selection), selection)).toBeUndefined();
    expect(addFreePath(doc, "paths", [{ x: 1, y: 1 }], "road", .3)).toBe(doc);
  });
  it("reproduces scatter after serialization, edits seed/size and preserves area order", () => {
    let doc = addScatter(fixture(), "scatter", { x: 12, y: 12 }, 3, "scatter/forest", 1, 1.2, 1742);
    doc = addScatter(doc, "scatter", { x: 20, y: 12 }, 2, "scatter/mountains", 1, 2, 1743);
    const layer = doc.layers.find(l => l.id === "scatter")!; if (layer.kind !== "scatter") throw Error();
    const [area] = layer.areas, instances = scatterInstances(area);
    expect(instances.items.length).toBeGreaterThan(10); expect(instances.error).toBeUndefined();
    expect(instances.items.every(i => shapeContains(area.shape, i.object.transform.position))).toBe(true);
    const loaded = parseMapDocumentV6(serializeMapDocumentV6(doc)); if (!loaded.ok) throw Error();
    const loadedLayer = loaded.value.layers.find(l => l.id === "scatter")!; if (loadedLayer.kind !== "scatter") throw Error();
    expect(scatterInstances(loadedLayer.areas[0])).toEqual(instances);
    expect(scatterInstances({ ...area, seed: area.seed + 1 })).not.toEqual(instances);
    const next = putScatter(doc, "scatter", { ...area, seed: 42 });
    const edited = next.layers.find(l => l.id === "scatter")!; if (edited.kind !== "scatter") throw Error();
    expect(edited.areas.map(a => a.id)).toEqual(layer.areas.map(a => a.id));
    expect(serializeMapDocumentV6(next)).not.toContain("instance:");
    expect(createWorkspaceRenderModel(next).diagnostics).toEqual([]);
    expect(createWorkspaceRenderModel(next).model.layers.map(l => l.id)).toEqual(next.layers.map(l => l.id));
  });
  it("rejects unknown profiles and excessive scatter without changing the input", () => {
    const doc = fixture(), raw = serializeMapDocumentV6(doc);
    expect(() => addScatter(doc, "scatter", { x: 4, y: 4 }, 2, "unknown", 1, 1, 1)).toThrow();
    expect(() => addScatter(doc, "scatter", { x: 4, y: 4 }, 100, "scatter/forest", 10, 1, 1)).toThrow(/велика/);
    expect(serializeMapDocumentV6(doc)).toBe(raw);
  });
  it("enforces visibility and lock for painting, drawing and scatter mutations", () => {
    for (const patch of [{ visible: false }, { locked: true }]) {
      const doc = { ...fixture(), layers: fixture().layers.map(l => ["surface", "paths", "scatter"].includes(l.id) ? { ...l, ...patch } : l) };
      expect(() => paintSurface(doc, "surface", { x: 3, y: 3 }, { x: 5, y: 3 }, 1, "forest")).toThrow(/скрыт|заблокирован/);
      expect(() => addFreePath(doc, "paths", [{ x: 3, y: 3 }, { x: 5, y: 3 }], "road", .2)).toThrow();
      expect(() => addScatter(doc, "scatter", { x: 4, y: 4 }, 2, "scatter/forest", 1, 1, 1)).toThrow();
    }
  });
  it("keeps the mask view cache across pan, and honours ordered layer changes", () => {
    const doc = paintSurface(fixture(), "surface", { x: 3, y: 3 }, { x: 5, y: 3 }, 1, "forest");
    const one = createWorkspaceRenderModel(doc), two = createWorkspaceRenderModel(doc);
    const a = one.model.layers.find(l => l.id === "surface"), b = two.model.layers.find(l => l.id === "surface");
    expect(a?.kind === "terrain" && a.terrain.mask).toBe(b?.kind === "terrain" && b.terrain.mask);
    const next = editGeometry(doc, view => moveLayer(view, "surface", 0));
    expect(createWorkspaceRenderModel(next).model.layers[0].id).toBe("surface");
  });
  it("mirrors objects and retains reflection while changing rotation and size", () => {
    const before = fixture(), layer = before.layers.find(l => l.kind === "object")!;
    let doc = addSymbol(before, layer.id, "mountain", { x: 5, y: 5 }, "soyman-symbols:mountain");
    doc = editGeometry(doc, view => transformMapObject(view, "mountain", 30, 2, true, false));
    doc = editGeometry(doc, view => transformMapObject(view, "mountain", 60, 3));
    const objects = doc.layers.find(l => l.id === layer.id)!; if (objects.kind !== "object") throw Error();
    expect(objects.items[0].transform.scale).toEqual({ x: -3, y: 3 });
    expect(objects.items[0].transform.rotation).toBe(60); expect(validateMapDocumentV6(doc)).toEqual([]);
  });
});
