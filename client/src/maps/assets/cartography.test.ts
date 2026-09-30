import { describe, expect, it, vi } from "vitest";
import { serializeMapDocumentV6, parseMapDocumentV6, tokensOf } from "@shared/maps/core";
import { CARTOGRAPHY_PACK, cartographyId } from "./cartography";
import { mapAssetPackForId, resolveMapSymbol, loadMapImageAsset, prepareMapImageAssets } from "./registry";
import { buildDungeonDocument, DUNGEON_PRESETS } from "../workspace/dungeonGeneration";
import { addSymbol, moveSelection } from "../workspace/editorCommands";
import { geometryView, editGeometry } from "../workspace/editDocument";
import { createScatterLayer } from "../core/mutations/layers";
import { addScatter } from "../workspace/artisticCommands";
import { createWorkspaceRenderModel } from "../workspace/renderV6";
import { assessCurrentEditorCompatibility } from "../core/compatibility";
import { scatterInstances } from "../scatter";

const fixture = () => buildDungeonDocument({ ...DUNGEON_PRESETS[0], seed: 29 }, "paper-ink");
describe("installed cartography", () => {
  it("persists a known pack, proportions-independent size, and stable IDs through edits and reload", () => {
    const before = fixture(), layer = before.layers.find(l => l.kind === "object")!;
    const added = addSymbol(before, layer.id, "altar", { x: 9.5, y: 10.5 }, cartographyId("altar"));
    expect(added.assetPacks).toContainEqual(CARTOGRAPHY_PACK);
    const moved = moveSelection(added, { id: "altar", layerId: layer.id, kind: "object" }, { x: 2, y: 1 });
    const loaded = parseMapDocumentV6(serializeMapDocumentV6(moved));
    expect(loaded).toEqual({ ok: true, value: moved });
    expect(tokensOf(moved)).toEqual(tokensOf(before));
    expect(serializeMapDocumentV6(moved)).not.toMatch(/webp|https?:|\/cartography\//);
    expect(createWorkspaceRenderModel(moved).diagnostics).toEqual([]);
    expect(mapAssetPackForId(cartographyId("altar"))).toEqual(CARTOGRAPHY_PACK);
  });
  it("rejects unknown IDs or incompatible installed versions without mutating the map", () => {
    const doc = fixture(), layer = doc.layers.find(l => l.kind === "object")!;
    const raw = serializeMapDocumentV6(doc);
    expect(() => addSymbol(doc, layer.id, "bad", { x: 4, y: 4 }, cartographyId("unknown"))).toThrow();
    expect(() => addSymbol({ ...doc, assetPacks: [ { ...CARTOGRAPHY_PACK, version: "2" } ] }, layer.id, "bad", { x: 4, y: 4 }, cartographyId("altar"))).toThrow();
    expect(serializeMapDocumentV6(doc)).toBe(raw);
  });
  it("keeps missing artwork editable and deduplicates failed local loads", async () => {
    const decode = vi.fn(async () => { throw new Error("missing local image"); });
    vi.stubGlobal("Image", class { src = ""; decode = decode; });
    try {
      const doc = fixture(), layer = doc.layers.find(l => l.kind === "object")!;
      const added = addSymbol(doc, layer.id, "bones", { x: 4, y: 4 }, cartographyId("bone-pile"));
      await expect(prepareMapImageAssets(added)).rejects.toThrow("missing local image");
      await expect(loadMapImageAsset(cartographyId("bone-pile"))).rejects.toThrow();
      expect(decode).toHaveBeenCalledOnce();
      expect(resolveMapSymbol({ type: "asset", assetId: cartographyId("bone-pile") })).toMatchObject({ kind: "image", image: null });
      expect(assessCurrentEditorCompatibility(geometryView(added)).compatible).toBe(true);
      expect(createWorkspaceRenderModel(added).model.layers.find(l => l.kind === "object")).toMatchObject({ items: [{ object: { id: "bones" } }] });
    } finally { vi.unstubAllGlobals(); }
  });
  it("records the pack for illustrated scatter and preserves the deterministic recipe", () => {
    let doc = fixture(); doc = editGeometry(doc, view => createScatterLayer(view, { id: "forest", name: "Лес" }));
    const added = addScatter(doc, "forest", { x: 10, y: 10 }, 3, "scatter/cartography-forest-v1", 0.8, 2, 123);
    const layer = added.layers.find(l => l.id === "forest")!;
    if (layer.kind !== "scatter") throw new Error("fixture");
    expect(added.assetPacks).toContainEqual(CARTOGRAPHY_PACK);
    expect(scatterInstances(structuredClone(layer.areas[0]))).toEqual(scatterInstances(layer.areas[0]));
    expect(createWorkspaceRenderModel(added).diagnostics).toEqual([]);
    expect(createWorkspaceRenderModel({ ...added, assetPacks: [] }).diagnostics).toContainEqual(expect.objectContaining({ code: "unsupported-scatter-layer" }));
  });
});
