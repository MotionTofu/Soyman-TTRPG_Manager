import { describe, expect, it, vi } from "vitest";
import { validateMapDocument } from "../core/validate";
import { projectMapDocumentForPlayer } from "../core/playerProjection";
import { hitTestGameplay } from "../core/selection/hitTest";
import { addMapObject, deleteMapObject, moveMapObject, transformMapObject } from "../core/mutations/mapObjects";
import { createObjectLayer } from "../core/mutations/layers";
import { assessCurrentEditorCompatibility } from "../core/compatibility";
import type { MapDocumentV5, MapObject } from "../core/types";
import { createV5RenderModel } from "../renderModel";
import { MAP_RESOURCE_IMAGE_PACK, MAP_SYMBOL_PACK, prepareMapImageAssets, registerMapImageResources, resourceImageAssetId, resolveMapSymbol } from "./registry";
import { createObjectTools } from "../editor/tools/objectTools";

function document(): MapDocumentV5 {
  return {
    v: 5,
    world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
    grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } },
    assetPacks: [MAP_SYMBOL_PACK],
    layers: [{ id: "objects", name: "Objects", kind: "object", visible: true, locked: false, opacity: 1, items: [] }],
  };
}

const tree: MapObject = {
  id: "tree-1",
  transform: { position: { x: 1.25, y: 2.75 }, rotation: 0, scale: { x: 1, y: 1 } },
  visual: { type: "asset", assetId: "soyman-symbols:tree" },
};

describe("local map symbols", () => {
  it("loads each referenced image once and decodes it before export", async () => {
    const uid = "92ad3ad0-b70b-45b1-9190-2193e50ab018";
    const assetId = resourceImageAssetId(uid);
    const fetchImage = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) }));
    const decode = vi.fn(async () => undefined);
    const createObjectURL = vi.fn(() => "blob:map-image-test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetchImage);
    vi.stubGlobal("localStorage", { getItem: () => "test-token" });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    vi.stubGlobal("Image", class {
      src = "";
      decode = decode;
    });
    try {
      registerMapImageResources([{ uid, name: "Дерево", file_url: "/files/tree.png?v=2&sig=temporary&exp=42" }]);
      const doc = {
        ...document(), assetPacks: [MAP_RESOURCE_IMAGE_PACK],
        layers: [{ ...document().layers[0], kind: "object" as const, items: [
          { ...tree, id: "image-1", visual: { type: "asset" as const, assetId } },
          { ...tree, id: "image-2", visual: { type: "asset" as const, assetId } },
        ] }],
      };
      await prepareMapImageAssets(doc);
      expect(fetchImage).toHaveBeenCalledTimes(1);
      expect(fetchImage).toHaveBeenCalledWith("/files/tree.png?v=2", { headers: { Authorization: "Bearer test-token" } });
      expect(decode).toHaveBeenCalledOnce();
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      const asset = resolveMapSymbol({ type: "asset", assetId });
      expect(asset).toMatchObject({ kind: "image", name: "Дерево" });
      if (asset && "kind" in asset) expect(asset.image).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("uses a stable Resource UID and requires the matching image pack", () => {
    const uid = "d611dafe-48fe-445a-944d-cac4d8d9ec5b";
    registerMapImageResources([{ uid, name: "Моё дерево", file_url: "/files/tree.png?v=2&sig=temporary", tags: "лес, декор" }]);
    const visual = { type: "asset" as const, assetId: resourceImageAssetId(uid) };
    const added = addMapObject({ ...document(), assetPacks: [MAP_RESOURCE_IMAGE_PACK] }, "objects", { ...tree, visual });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(createV5RenderModel(added.document).diagnostics).toEqual([]);
    expect(assessCurrentEditorCompatibility(added.document).compatible).toBe(true);
    const noPack = { ...added.document, assetPacks: [MAP_SYMBOL_PACK] };
    expect(createV5RenderModel(noPack).diagnostics.map((d) => d.code)).toContain("unsupported-object-layer");
  });
  it("places a symbol through the editor tool and records its pack", () => {
    const initial = { ...document(), assetPacks: [] };
    const documentRef = { current: initial as MapDocumentV5 | null };
    const commit = vi.fn((next: MapDocumentV5) => { documentRef.current = next; });
    const error = vi.fn();
    const tool = createObjectTools({
      geom: { grid: "square", width: 8, height: 8 },
      lastTrapKind: "pit", markerKind: "city", assetId: "soyman-symbols:tree",
      activeLayerId: "objects", onActiveLayer: vi.fn(), setActionError: error,
      documentRef, commitDocument: commit, newId: () => "placed-tree",
    });
    tool.placeObject("asset", 2.3, 3.7);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(documentRef.current?.assetPacks).toEqual([MAP_SYMBOL_PACK]);
    const layer = documentRef.current?.layers[0];
    expect(layer?.kind).toBe("object");
    if (layer?.kind === "object") expect(layer.items[0].transform.position).toEqual({ x: 2.3, y: 3.7 });
    expect(validateMapDocument(documentRef.current)).toEqual([]);
  });
  it("places, renders, selects, transforms, projects, and removes a free object", () => {
    const initial = document();
    const added = addMapObject(initial, "objects", tree);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(validateMapDocument(added.document)).toEqual([]);
    expect(createV5RenderModel(added.document).diagnostics).toEqual([]);
    expect(assessCurrentEditorCompatibility(added.document).compatible).toBe(true);
    expect(hitTestGameplay(added.document, { x: 1.25, y: 2.75 })).toEqual({ entityId: tree.id, kind: "object" });
    expect(projectMapDocumentForPlayer(added.document).layers).toEqual(added.document.layers);

    const moved = moveMapObject(added.document, tree.id, { x: 3.125, y: 4.25 });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(hitTestGameplay(moved.document, { x: 3.125, y: 4.25 })?.entityId).toBe(tree.id);
    const turned = transformMapObject(moved.document, tree.id, 45, 2);
    expect(turned.ok).toBe(true);
    if (!turned.ok) return;
    expect(validateMapDocument(turned.document)).toEqual([]);
    const removed = deleteMapObject(turned.document, tree.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(hitTestGameplay(removed.document, { x: 3.125, y: 4.25 })).toBeNull();
  });

  it("keeps unknown or unavailable pack objects behind the compatibility gate", () => {
    const doc = document();
    const unknown = addMapObject(doc, "objects", { ...tree, visual: { type: "asset", assetId: "missing:tree" } });
    if (!unknown.ok) throw new Error("fixture failed");
    expect(createV5RenderModel(unknown.document).diagnostics.map((d) => d.code)).toContain("unsupported-object-layer");
    expect(assessCurrentEditorCompatibility(unknown.document).compatible).toBe(false);
    const missingPack = { ...doc, assetPacks: [], layers: [{ ...doc.layers[0], kind: "object" as const, items: [tree] }] };
    expect(createV5RenderModel(missingPack).diagnostics.map((d) => d.code)).toContain("unsupported-object-layer");
  });

  it("creates a new object layer and respects hidden or locked layers when selecting", () => {
    const doc = { ...document(), layers: [] };
    const created = createObjectLayer(doc, { id: "objects", name: "Symbols" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const added = addMapObject(created.document, "objects", tree);
    if (!added.ok) throw new Error("fixture failed");
    const layer = added.document.layers[0];
    expect(hitTestGameplay({ ...added.document, layers: [{ ...layer, visible: false }] }, tree.transform.position)).toBeNull();
    expect(hitTestGameplay({ ...added.document, layers: [{ ...layer, locked: true }] }, tree.transform.position)).toBeNull();
  });
});
