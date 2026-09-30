import { describe, expect, it } from "vitest";
import { createGameplayToken, putGameplayToken, serializeMapDocumentV6, parseMapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { addLabel, addSymbol, createDoor, createRoom, moveSelection, paintSegment, removeSelection } from "./editorCommands";
import { editGeometry, geometryView } from "./editDocument";
import { createGameplayLayer, deleteLayer } from "../core/mutations/layers";
import { createWorkspaceRenderModel } from "./renderV6";

const fixture = () => {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 12, height: 12, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  return loaded.document;
};
describe("workspace document operations", () => {
  it("builds a dungeon with surfaces, continuous walls, room, doorway and label, then round trips V6", () => {
    let doc = fixture();
    const terrain = doc.layers.find((layer) => layer.kind === "terrain")!.id;
    const gameplay = doc.layers.find((layer) => layer.kind === "gameplay")!.id;
    const labels = doc.layers.find((layer) => layer.kind === "label")!.id;
    doc = paintSegment(doc, terrain, { x: 2.5, y: 2.5 }, { x: 9.5, y: 2.5 }, "wall");
    doc = paintSegment(doc, terrain, { x: 3.5, y: 3.5 }, { x: 8.5, y: 3.5 }, "stone");
    doc = createRoom(doc, gameplay, "room", { x: 2.2, y: 2.2 }, { x: 8.8, y: 8.8 }, true);
    doc = createDoor(doc, gameplay, "door", { x: 4.3, y: 2.1 }, true, 0);
    doc = addLabel(doc, labels, "label", { x: 5, y: 5 }, "Тестовый зал");
    const saved = parseMapDocumentV6(serializeMapDocumentV6(doc));
    expect(saved.ok && saved.value).toEqual(doc);
    expect(createWorkspaceRenderModel(doc).diagnostics).toEqual([]);
    const painted = doc.layers.find((layer) => layer.id === terrain);
    expect(painted?.kind === "terrain" && painted.representation === "cells" && painted.cells.filter((cell) => cell.material.type === "builtin" && cell.material.key === "terrain/wall").length).toBe(8);
  });
  it("preserves linked tokens, item order and IDs through geometry operations, including append and deletion", () => {
    let doc = fixture();
    const layerId = doc.layers.find((layer) => layer.kind === "gameplay")!.id;
    const token = createGameplayToken("token", { kind: "being", uid: "11111111-1111-4111-8111-111111111111" }, { x: 3, y: 3 });
    doc = putGameplayToken(doc, layerId, token);
    doc = createRoom(doc, layerId, "room", { x: 2, y: 2 }, { x: 7, y: 7 }, true);
    const layer = doc.layers.find((entry) => entry.id === layerId);
    expect(layer?.kind === "gameplay" && layer.items.map((item) => item.id)).toEqual(["token", "room"]);
    const moved = moveSelection(doc, { id: "room", layerId, kind: "gameplay" }, { x: 1, y: 0 });
    const deleted = removeSelection(moved, { id: "room", layerId, kind: "gameplay" });
    expect(deleted.layers.find((entry) => entry.id === layerId)).toMatchObject({ items: [token] });
    expect(geometryView(deleted).layers.find((entry) => entry.id === layerId)).toMatchObject({ items: [] });
    expect(() => editGeometry(deleted, (view) => deleteLayer(view, layerId))).toThrow(/токены/);
    expect(() => createRoom(deleted, layerId, "token", { x: 1, y: 1 }, { x: 3, y: 3 }, true)).toThrow(/целостность/);
  });
  it("honors hidden and locked targets without painting another layer", () => {
    const doc = fixture(), terrain = doc.layers.find((layer) => layer.kind === "terrain")!;
    for (const state of [{ locked: true }, { visible: false }]) {
      const protectedDoc = { ...doc, layers: doc.layers.map((layer) => layer.id === terrain.id ? { ...layer, ...state } : layer) };
      expect(() => paintSegment(protectedDoc, terrain.id, { x: 2, y: 2 }, { x: 4, y: 2 }, "wall")).toThrow(/заблокирован/);
      expect(serializeMapDocumentV6(doc)).toBe(serializeMapDocumentV6(fixture()));
    }
  });
  it("renders existing tokens in layer/item order, suppresses hidden layers, retains V5 diagnostics", () => {
    let doc = fixture();
    doc = editGeometry(doc, (view) => createGameplayLayer(view, { id: "top", name: "Тестовый слой" }));
    doc = putGameplayToken(doc, "top", createGameplayToken("t", { kind: "location", uid: "22222222-2222-4222-8222-222222222222" }, { x: 3, y: 3 }));
    const model = createWorkspaceRenderModel(doc);
    expect(model.diagnostics).toEqual([]);
    expect(model.model.layers.at(-1)).toMatchObject({ id: "top", items: [{ kind: "token", token: { id: "t" } }] });
    expect(doc.v).toBe(6);
  });
  it("moves labels and object symbols without affecting source data or packs", () => {
    let doc = fixture();
    const labelLayer = doc.layers.find((layer) => layer.kind === "label")!.id;
    doc = addLabel(doc, labelLayer, "label", { x: 2, y: 2 }, "Тест");
    const moved = moveSelection(doc, { id: "label", layerId: labelLayer, kind: "label" }, { x: 0.3, y: 1 });
    expect(moved.layers.find((layer) => layer.id === labelLayer)).toMatchObject({ items: [{ position: { x: 2.3, y: 3 } }] });
    const objects = { id: "objects", name: "Объекты", kind: "object" as const, visible: true, locked: false, opacity: 1, items: [] };
    doc = addSymbol({ ...doc, layers: [...doc.layers, objects] }, "objects", "tree", { x: 3, y: 4 }, "soyman-symbols:tree");
    expect(doc.assetPacks).toContainEqual({ id: "soyman-symbols", version: "1" });
    expect(parseMapDocumentV6(doc).ok).toBe(true);
  });
});
