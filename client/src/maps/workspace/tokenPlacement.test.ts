import { describe, expect, it } from "vitest";
import { parseMapDocumentV6, serializeMapDocumentV6, tokensOf, detachGameplayToken } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { moveSelection, removeSelection, updateToken } from "./editorCommands";
import { parsePlacementPayload, placementSource, placeToken, tokenTarget, type ResolvedTokenSource } from "./tokenPlacement";
import { createWorkspaceRenderModel } from "./renderV6";
import { cellCenter } from "../grid";
const source: ResolvedTokenSource = { sourceRef: { kind: "being", uid: "11111111-1111-4111-8111-111111111111" }, id: 8, state: "active", name: "Тестовое существо", portrait_url: null, visual: { type: "builtin", key: "being" } };
function fixture(grid: "square" | "hex" = "square") {
  const loaded = loadStoredWorkspaceDocument({ grid, width: 12, height: 12, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  return loaded.document;
}
describe("checked entity placement", () => {
  it("accepts bestiary monsters and older bag entries without subtype, rejects other compendium kinds", () => {
    expect(placementSource({ type: "compendium_entry", id: 9, kind: "monster" })).toEqual({ type: "compendium_entry", id: 9 });
    expect(placementSource({ type: "compendium_entry", id: 9 })).toEqual({ type: "compendium_entry", id: 9 });
    expect(placementSource({ type: "compendium_entry", id: 9, kind: "spell" })).toBeNull();
  });
  it.each([null, {}, { type: "character", id: 1 }, { type: "being", id: "1" }, { type: "being", id: -1 }, { type: "being", id: 1.5 }, { type: "location", id: Infinity }])("rejects unsupported payload %j", (value) => expect(placementSource(value)).toBeNull());
  it("ignores untrusted identity and presentation fields, rejects malformed and oversized JSON", () => {
    expect(parsePlacementPayload(JSON.stringify({ type: "being", id: 8, uid: "forged", title: "forged", portrait_url: "https://example.invalid" }))).toEqual({ type: "being", id: 8 });
    expect(parsePlacementPayload("not-json")).toBeNull(); expect(parsePlacementPayload(" ".repeat(32769))).toBeNull();
  });
  it.each(["square", "hex"] as const)("snaps %s placement, creates independent instances, preserves refs through move/properties/reload", (grid) => {
    let doc = fixture(grid); const layerId = tokenTarget(doc, ""), center = cellCenter(grid, 3, 3);
    doc = placeToken(doc, layerId, "first", source, { x: center.cx + 0.1, y: center.cy + 0.1 }, true);
    doc = placeToken(doc, layerId, "second", source, { x: center.cx + 0.2, y: center.cy }, false);
    expect(tokensOf(doc).map((token) => token.id)).toEqual(["first", "second"]);
    expect(tokensOf(doc)[0].position).toEqual({ x: center.cx, y: center.cy });
    const selection = { id: "first", layerId, kind: "token" as const };
    expect(moveSelection(doc, selection, { x: 0, y: 0 })).toBe(doc);
    const before = serializeMapDocumentV6(doc);
    doc = moveSelection(doc, selection, { x: 0.25, y: 1 });
    doc = updateToken(doc, selection, (token) => ({ ...token, size: 2, rotation: 45, label: { mode: "custom", text: "Тестовый страж" } }));
    const reloaded = parseMapDocumentV6(serializeMapDocumentV6(doc));
    expect(reloaded.ok && tokensOf(reloaded.value)[0]).toMatchObject({ id: "first", sourceRef: source.sourceRef, size: 2, rotation: 45, playerVisibility: "private" });
    expect(tokensOf(parseMapDocumentV6(before).ok ? JSON.parse(before) : doc)[0].position).toEqual({ x: center.cx, y: center.cy });
    const removed = removeSelection(doc, selection); expect(tokensOf(removed).map((token) => token.id)).toEqual(["second"]);
    expect(tokensOf(doc)).toHaveLength(2);
  });
  it("does not bypass a selected hidden/locked gameplay layer or mutate on failure", () => {
    const doc = fixture(), layerId = tokenTarget(doc, "");
    for (const state of [{ locked: true }, { visible: false }]) {
      const protectedDoc = { ...doc, layers: doc.layers.map((layer) => layer.id === layerId ? { ...layer, ...state } : layer) };
      expect(() => tokenTarget(protectedDoc, layerId)).toThrow(/заблокирован/);
      expect(() => placeToken(protectedDoc, layerId, "t", source, { x: 1, y: 1 }, true)).toThrow();
      expect(tokensOf(protectedDoc)).toEqual([]);
    }
  });
  it("keeps dynamic presentation outside canonical data and detaches without editing the entity", () => {
    let doc = fixture(); const layerId = tokenTarget(doc, "");
    const portraitSource: ResolvedTokenSource = { ...source, visual: { type: "entity-avatar", source: source.sourceRef } };
    doc = placeToken(doc, layerId, "t", portraitSource, { x: 2, y: 2 }, true);
    const raw = serializeMapDocumentV6(doc);
    const model = createWorkspaceRenderModel(doc, new Map([[`being:${source.sourceRef.uid}`, { ...source, name: "Новое имя" }]]));
    expect(model.model.layers.find((layer) => layer.kind === "gameplay")).toMatchObject({ items: [{ display: { name: "Новое имя" } }] });
    expect(raw).not.toContain("Новое имя"); expect(raw).not.toContain("portrait_url"); expect(raw).not.toContain('"id":8');
    doc = updateToken(doc, { id: "t", layerId, kind: "token" }, (token) => detachGameplayToken(token, "Визуальная копия"));
    expect(tokensOf(doc)[0]).toMatchObject({ sourceRef: null, label: { mode: "custom", text: "Визуальная копия" }, appearance: { visual: { type: "builtin", key: "being" } } });
  });
});
