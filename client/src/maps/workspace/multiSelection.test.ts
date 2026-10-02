import { describe, expect, it } from "vitest";
import type { MapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { addLabel, addSymbol } from "./editorCommands";
import { mergeSelections, moveSelections, removeSelections, selectInRect, selectionRect } from "./multiSelection";

function fixture() {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 12, height: 12, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  let doc: MapDocumentV6 = { ...loaded.document, layers: [...loaded.document.layers, { id: "objects", name: "Objects", kind: "object", visible: true, locked: false, opacity: 1, items: [] }] };
  doc = addSymbol(doc, "objects", "a", { x: 2, y: 2 }, "soyman-symbols:tree");
  doc = addSymbol(doc, "objects", "b", { x: 4, y: 3 }, "soyman-symbols:tree");
  doc = addSymbol(doc, "objects", "outside", { x: 10, y: 10 }, "soyman-symbols:tree");
  const labelLayer = doc.layers.find(layer => layer.kind === "label")!.id;
  return addLabel(doc, labelLayer, "label", { x: 3, y: 2 }, "Label");
}
const frame = selectionRect({ x: 5, y: 4 }, { x: 1, y: 1 });
describe("workspace multi-selection", () => {
  it("selects intersecting items across layers in either drag direction without editing the map", () => {
    const doc = fixture(), original = JSON.stringify(doc);
    expect(frame).toEqual({ x: 1, y: 1, w: 4, h: 3 });
    expect(selectInRect(doc, frame).map(entry => entry.id).sort()).toEqual(["a", "b", "label"]);
    expect(JSON.stringify(doc)).toBe(original);
  });
  it("skips hidden and locked layers", () => {
    for (const flags of [{ visible: false }, { locked: true }]) {
      const doc = fixture();
      doc.layers = doc.layers.map(layer => layer.id === "objects" ? { ...layer, ...flags } : layer);
      expect(selectInRect(doc, frame).map(entry => entry.id)).toEqual(["label"]);
    }
  });
  it("handles the rotated footprint of a large object", () => {
    const doc = fixture(), layer = doc.layers.find(layer => layer.id === "objects");
    if (layer?.kind !== "object") throw Error("fixture");
    layer.items[0].transform = { position: { x: 2, y: 2 }, scale: { x: 4, y: 1 }, rotation: 90 };
    expect(selectInRect(doc, { x: 1.9, y: 3.8, w: 0.2, h: 0.1 }).map(entry => entry.id)).toContain("a");
    expect(selectInRect(doc, { x: 3.8, y: 1.9, w: 0.1, h: 0.2 }).map(entry => entry.id)).not.toContain("a");
  });
  it("adds without duplicates and moves/deletes a group while retaining the undo baseline", () => {
    const doc = fixture(), before = JSON.stringify(doc), selected = selectInRect(doc, frame);
    expect(mergeSelections(selected, selected)).toEqual(selected);
    const moved = moveSelections(doc, selected, { x: 1, y: 2 });
    const layer = moved.layers.find(layer => layer.id === "objects");
    expect(layer?.kind === "object" && layer.items.map(item => item.transform.position)).toEqual([{ x: 3, y: 4 }, { x: 5, y: 5 }, { x: 10, y: 10 }]);
    const removed = removeSelections(moved, selected);
    expect(selectInRect(removed, { x: 0, y: 0, w: 12, h: 12 }).map(entry => entry.id)).toEqual(["outside"]);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
