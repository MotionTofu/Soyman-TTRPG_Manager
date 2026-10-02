import { describe, expect, it } from "vitest";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { cellBrushFootprint, createRoom, paintSegment } from "./editorCommands";
import { paintCellShapes, selectedRoomShapes } from "./cellPainting";
import { addWall } from "./walls";
function fixture() {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 12, height: 12, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  const doc = loaded.document;
  return { doc, floor: doc.layers.find(l => l.kind === "terrain")!.id, rooms: doc.layers.find(l => l.kind === "gameplay")!.id };
}
describe("cell floor painting", () => {
  it("uses the same clipped footprint for odd/even brush sizes and fast paint strokes", () => {
    const { doc, floor } = fixture();
    expect(cellBrushFootprint(doc, { x: 5.5, y: 5.5 }, 3)).toHaveLength(9);
    expect(cellBrushFootprint(doc, { x: 5.9, y: 5.9 }, 2)).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }]);
    expect(cellBrushFootprint(doc, { x: 0.2, y: 0.2 }, 3)).toHaveLength(4);
    const painted = paintSegment(doc, floor, { x: 2.5, y: 5.5 }, { x: 8.5, y: 5.5 }, "stone", 3);
    const layer = painted.layers.find(l => l.id === floor);
    expect(layer?.kind === "terrain" && layer.representation === "cells" && layer.cells.length).toBe(27);
    const cleared = paintSegment(painted, floor, { x: 5.5, y: 5.5 }, { x: 5.5, y: 5.5 }, null, 3);
    const result = cleared.layers.find(l => l.id === floor);
    expect(result?.kind === "terrain" && result.representation === "cells" && result.cells.length).toBe(18);
  });
  it("fills the entire rectangular selection and erases it without touching surrounding floor", () => {
    const { doc, floor } = fixture();
    const outside = paintSegment(doc, floor, { x: 10.5, y: 10.5 }, { x: 10.5, y: 10.5 }, "wood");
    const shape = { type: "rect" as const, x: 1, y: 1, w: 3, h: 2 };
    const painted = paintCellShapes(outside, floor, [shape], "stone"), layer = painted.layers.find(l => l.id === floor);
    expect(layer?.kind === "terrain" && layer.representation === "cells" && layer.cells.length).toBe(7);
    const cleared = paintCellShapes(painted, floor, [shape], null);
    expect(cleared.layers.find(l => l.id === floor)).toEqual(outside.layers.find(l => l.id === floor));
  });
  it("fills selected rooms together, deduplicates overlaps and leaves room geometry unchanged", () => {
    const { doc, floor, rooms } = fixture();
    const first = createRoom(doc, rooms, "r1", { x: 1, y: 1 }, { x: 4, y: 4 }, true);
    const second = createRoom(first, rooms, "r2", { x: 3, y: 3 }, { x: 6, y: 6 }, true);
    const shapes = selectedRoomShapes(second, [{ id: "r1", layerId: rooms, kind: "gameplay" }, { id: "r2", layerId: rooms, kind: "gameplay" }]);
    const painted = paintCellShapes(second, floor, shapes, "stone"), layer = painted.layers.find(l => l.id === floor);
    expect(layer?.kind === "terrain" && layer.representation === "cells" && layer.cells.length).toBe(17);
    expect(painted.layers.find(l => l.id === rooms)).toEqual(second.layers.find(l => l.id === rooms));
  });
  it("recognizes a selected closed wall as a fillable contour and leaves an open wall out", () => {
    const { doc, floor } = fixture();
    const base = { ...doc, layers: [...doc.layers, { id: "walls", name: "Стены", kind: "path" as const, visible: true, locked: false, opacity: 1, paths: [] }] };
    const closed = addWall(base, "walls", [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 1, y: 5 }], 0.36, true);
    const layer = closed.layers.find(l => l.id === "walls");
    if (layer?.kind !== "path") throw Error("fixture");
    const selected = [{ id: layer.paths[0].id, layerId: "walls", kind: "path" as const }];
    const shapes = selectedRoomShapes(closed, selected);
    expect(shapes).toHaveLength(1);
    const painted = paintCellShapes(closed, floor, shapes, "stone"), terrain = painted.layers.find(l => l.id === floor);
    if (terrain?.kind !== "terrain" || terrain.representation !== "cells") throw Error("fixture");
    expect(terrain.cells.some(cell => cell.x === 2 && cell.y === 2)).toBe(true);
    expect(terrain.cells.some(cell => cell.x === 4 && cell.y === 4)).toBe(false);
    const opened = { ...closed, layers: closed.layers.map(l => l.id === "walls" && l.kind === "path" ? { ...l, paths: l.paths.map(p => ({ ...p, properties: { closed: false } })) } : l) };
    expect(selectedRoomShapes(opened, selected)).toEqual([]);
  });
  it("respects target layer locks", () => {
    const { doc, floor } = fixture();
    expect(() => paintCellShapes({ ...doc, layers: doc.layers.map(l => l.id === floor ? { ...l, locked: true } : l) }, floor, [{ type: "rect", x: 0, y: 0, w: 2, h: 2 }], "stone")).toThrow();
  });
});
