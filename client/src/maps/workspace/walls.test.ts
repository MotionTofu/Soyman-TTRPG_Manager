import { describe, expect, it } from "vitest";
import { parseMapDocumentV6, serializeMapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { createWorkspaceRenderModel } from "./renderV6";
import { editPathNode, moveArtSelection } from "./artisticCommands";
import { addWall, setWallClosed, wallPoint } from "./walls";
import { insertWallNodes, setWallNodeWidth, wallNodeIntervals } from "./wallNodes";
import { selectedPath } from "./artisticCommands";
import { wallSegments, wallHit } from "../wallGeometry";

function fixture() {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 12, height: 12, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  return { ...loaded.document, layers: [...loaded.document.layers, { id: "walls", name: "Стены", kind: "path" as const, visible: true, locked: false, opacity: 1, paths: [] }] };
}
const square = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }];
describe("polyline walls", () => {
  it("stores individual node widths, inserts interpolated midpoints on selected closing edges, and resets widths", () => {
    let doc = addWall(fixture(), "walls", square, .36, true);
    const layer = doc.layers.find(l => l.id === "walls");
    if (layer?.kind !== "path") throw Error("fixture");
    const selection = { id: layer.paths[0].id, layerId: "walls", kind: "path" as const };
    doc = setWallNodeWidth(doc, selection, [0], 1.2);
    expect(wallNodeIntervals(4, [0, 1, 3], true)).toEqual([0, 3]);
    expect(wallNodeIntervals(4, [0, 2], true)).toEqual([]);
    const inserted = insertWallNodes(doc, selection, [0, 1, 3]);
    expect(inserted.indices).toEqual([1, 5]);
    const path = selectedPath(inserted.document, selection)!;
    if (path.geometry.type !== "spline") throw Error("fixture");
    expect(path.geometry.nodes).toHaveLength(6);
    expect(path.geometry.nodes[1]).toMatchObject({ position: { x: 3, y: 1 }, width: .78 });
    expect(path.geometry.nodes[5]).toMatchObject({ position: { x: 1, y: 3 }, width: .78 });
    expect(parseMapDocumentV6(serializeMapDocumentV6(inserted.document))).toMatchObject({ ok: true });
    const reset = setWallNodeWidth(inserted.document, selection, [0]);
    const resetPath = selectedPath(reset, selection)!;
    expect(resetPath.geometry.type === "spline" && resetPath.geometry.nodes[0].width).toBeUndefined();
  });
  it("tapers geometry smoothly and selects only the local wall thickness", () => {
    const points = [{ x: 0, y: 0, width: .2 }, { x: 4, y: 0, width: 2 }, { x: 4, y: 4, width: .4 }];
    const segments = wallSegments(points, .36, false);
    expect(segments[0].startWidth).toBe(.2);
    expect(segments[0].endWidth).toBe(2);
    expect(segments[0].polygon[0]).toEqual({ x: 0, y: .1 });
    expect(wallHit(points, .36, false, { x: 3.8, y: .8 }, 0)).toBe(true);
    expect(wallHit(points, .36, false, { x: .1, y: .8 }, 0)).toBe(false);
    expect(segments[0].polygon.slice(1, 3)).toEqual([segments[1].polygon[0], segments[1].polygon.at(-1)]);
  });

  it("snaps to grid intersections rather than cell centers and supports free points", () => {
    expect(wallPoint(fixture(), { x: 1.2, y: 2.8 }, true)).toEqual({ x: 1, y: 3 });
    expect(wallPoint(fixture(), { x: 1.2, y: 2.8 }, false)).toEqual({ x: 1.2, y: 2.8 });
  });
  it("stores one straight closed wall, survives V6 exchange and reaches the shared renderer", () => {
    const before = fixture(), doc = addWall(before, "walls", [...square, square[0]], 0.36, true);
    const layer = doc.layers.find(l => l.id === "walls");
    expect(layer?.kind === "path" && layer.paths).toMatchObject([{ kind: "wall", width: 0.36, properties: { closed: true }, geometry: { nodes: square.map(position => ({ position })) } }]);
    const parsed = parseMapDocumentV6(serializeMapDocumentV6(doc));
    expect(parsed.ok && parsed.value).toEqual(doc);
    const rendered = createWorkspaceRenderModel(doc);
    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.model.layers.find(l => l.id === "walls")).toMatchObject({ paths: [{ kind: "wall", closed: true }] });
    expect(before.layers.find(l => l.id === "walls")).toMatchObject({ paths: [] });
  });
  it("recalculates a closed wall after moving a node or the whole wall, and can reopen it", () => {
    const doc = addWall(fixture(), "walls", square, 0.4, true), layer = doc.layers.find(l => l.id === "walls");
    if (layer?.kind !== "path") throw Error("fixture");
    const selection = { kind: "path" as const, id: layer.paths[0].id, layerId: layer.id };
    const edited = editPathNode(doc, selection, 0, "position", { x: 0, y: 0 });
    const moved = moveArtSelection(edited, selection, { x: 1, y: 2 });
    const changed = moved.layers.find(l => l.id === "walls");
    expect(changed?.kind === "path" && changed.paths[0]).toMatchObject({ properties: { closed: true }, geometry: { nodes: [{ position: { x: 1, y: 2 } }, { position: { x: 6, y: 3 } }, { position: { x: 6, y: 7 } }, { position: { x: 2, y: 7 } }] } });
    expect(setWallClosed(moved, "walls", selection.id, false).layers.find(l => l.id === "walls")).toMatchObject({ paths: [{ properties: { closed: false } }] });
  });
  it("shares exact joint boundaries, includes the closing segment, and bounds sharp corners", () => {
    const segments = wallSegments(square, 0.4, true);
    expect(segments).toHaveLength(4);
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i], next = segments[(i + 1) % segments.length];
      expect(current.polygon[1]).toEqual(next.polygon[0]);
      expect(current.polygon[2]).toEqual(next.polygon.at(-1));
    }
    const sharp = wallSegments([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 0.2 }], 0.4, false);
    expect(sharp[0].polygon).toHaveLength(5);
    for (const p of sharp[0].polygon.slice(1, -1)) expect(Math.hypot(p.x - 5, p.y)).toBeLessThanOrEqual(0.400001);
    expect(wallSegments([square[0], square[0], square[1]], 0.4, false)).toHaveLength(1);
  });
  it("does not create zero-length walls and respects layer protection", () => {
    const doc = fixture();
    expect(addWall(doc, "walls", [square[0], square[0]], 0.4)).toBe(doc);
    expect(() => addWall({ ...doc, layers: doc.layers.map(l => l.id === "walls" ? { ...l, locked: true } : l) }, "walls", square, 0.4)).toThrow();
  });
});
