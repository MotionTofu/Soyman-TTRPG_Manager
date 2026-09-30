import { describe, expect, it } from "vitest";
import { parseStoredMapDocument, mapClientMaxVersion } from "./storedDocument";
import { serializeMapDocument } from "./serialize";
import { createGameplayToken, detachGameplayToken, putGameplayToken, removeGameplayToken,
  readMapDocumentV6, upgradeMapDocumentV5, parseMapDocumentV6, serializeMapDocumentV6,
  tokensOf, validateMapDocumentV6, type MapDocumentV6 } from "./v6";
import type { MapDocumentV5 } from "./types";

const ref = { kind: "being" as const, uid: "12345678-1234-1234-1234-123456789abc" };
function oldDocument(): MapDocumentV5 {
  return { v: 5, world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
    grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } },
    exploration: { enabled: true, revealedCells: [{ x: 2, y: 1 }, { x: 1, y: 1 }] }, assetPacks: [{ id: "test", version: "1" }],
    layers: [{ id: "gp", kind: "gameplay", name: "Test", visible: true, locked: false, opacity: 1, items: [] },
      { id: "path", kind: "path", name: "Test path", visible: false, locked: true, opacity: 0.5, paths: [
        { id: "main", kind: "river", width: 1, styleRef: { type: "builtin", key: "river" },
          geometry: { type: "spline", nodes: [{ position: { x: 1, y: 1 }, out: { x: 2, y: 1 }, width: 2 }, { position: { x: 3, y: 1 }, in: { x: 2, y: 1 } }] }, properties: { note: "preserve" } },
        { id: "branch", kind: "river", width: 1, styleRef: { type: "builtin", key: "river" }, branchFrom: { pathId: "main", nodeIndex: 1 },
          geometry: { type: "spline", nodes: [{ position: { x: 3, y: 1 } }, { position: { x: 4, y: 2 } }] } } ] },
      { id: "mask", kind: "terrain", name: "Mask", visible: true, locked: false, opacity: 1, representation: "mask", defaultMaterial: { type: "builtin", key: "terrain/plain" },
        mask: { origin: { x: 0, y: 0 }, sampleSize: 1, materials: [{ type: "builtin", key: "terrain/stone" }], chunks: [{ id: "chunk", cx: 0, cy: 0, payload: { encoding: "palette-index-v1", values: Array(256).fill(1) } }] } } ] };
}
describe("V6 boundary and tokens", () => {
  it("drawing styles survive canonical save/reload and token edits; unknown styles are rejected", () => {
    for (const style of ["blueprint", "paper-ink"] as const) {
      const doc = { ...upgradeMapDocumentV5(oldDocument()), appearance: { style } };
      const edited = putGameplayToken(doc, "gp", createGameplayToken("test-style", ref, { x: 1, y: 1 }));
      expect(parseMapDocumentV6(serializeMapDocumentV6(edited))).toEqual({ ok: true, value: edited });
      expect(edited.appearance).toEqual({ style });
    }
    expect(parseMapDocumentV6({ ...upgradeMapDocumentV5(oldDocument()), appearance: { style: "unknown" } }).ok).toBe(false);
  });
  it("bestiary refs remain independent and portable; creatures use the being silhouette", () => {
    const source = { kind: "compendium_entry" as const, uid: ref.uid };
    const token = { ...createGameplayToken("bestiary-token", source, { x: 2, y: 3 }), appearance: { shape: "circle" as const, visual: { type: "entity-avatar" as const, source } } };
    expect(createGameplayToken("plain", source, { x: 1, y: 1 }).appearance).toEqual({ shape: "circle", visual: { type: "builtin", key: "being" } });
    const doc = putGameplayToken(upgradeMapDocumentV5(oldDocument()), "gp", token);
    expect(parseMapDocumentV6(serializeMapDocumentV6(doc))).toEqual({ ok: true, value: doc });
    expect(detachGameplayToken(token, "Test creature")).toMatchObject({ sourceRef: null, appearance: { visual: { type: "builtin", key: "being" } } });
  });
  it("detects future/unknown versions without changing raw bytes", () => {
    for (const v of [0, 7, 99, "6", null]) {
      const raw = ` { "v": ${JSON.stringify(v)}, "secret": "keep" } \n`;
      expect(parseStoredMapDocument(raw)).toMatchObject({ format: "unsupported", raw });
    }
    expect(parseStoredMapDocument("garbage").format).toBe("corrupt");
    expect(parseStoredMapDocument('{"v":6}').format).toBe("v6");
    for (const version of [1, 2, 3, 4]) expect(parseStoredMapDocument(JSON.stringify({ v: version })).format).toBe("legacy");
    expect(mapClientMaxVersion(undefined)).toBe(5);
    expect(mapClientMaxVersion("6")).toBe(6);
    expect(mapClientMaxVersion("6junk")).toBe(5);
    expect(parseStoredMapDocument('{"v":{"private":"Test secret"}}')).toMatchObject({ format: "unsupported", version: null });
  });
  it("V5 upgrade preserves every supported field and does not mutate input", () => {
    const old = oldDocument();
    const raw = serializeMapDocument(old);
    const upgraded = upgradeMapDocumentV5(old);
    expect(serializeMapDocumentV6(upgraded)).toBe(raw.replace('"v":5', '"v":6'));
    expect(readMapDocumentV6(raw)).toEqual({ ok: true, value: upgraded });
    expect(serializeMapDocument(old)).toBe(raw);
  });
  it("two placements have independent IDs, transforms/overrides survive reload", () => {
    let doc = upgradeMapDocumentV5(oldDocument());
    const one = createGameplayToken("token-a", ref, { x: 1.5, y: 1.5 });
    const two = { ...createGameplayToken("token-b", ref, { x: 2.5, y: 1.5 }), size: 2.25, rotation: 45,
      label: { mode: "custom" as const, text: "Test override" } };
    expect(one.playerVisibility).toBe("private");
    doc = putGameplayToken(putGameplayToken(doc, "gp", one), "gp", two);
    const raw = serializeMapDocumentV6(doc);
    expect(parseMapDocumentV6(raw)).toEqual({ ok: true, value: doc });
    expect(tokensOf(removeGameplayToken(doc, "token-a"))).toEqual([two]);
    expect(tokensOf(doc)).toHaveLength(2);
  });
  it("rejects invalid references, numeric identity, foreign avatars and unsafe geometry", () => {
    const base = createGameplayToken("a", ref, { x: 1, y: 1 });
    for (const patch of [{ sourceRef: { kind: "character", uid: ref.uid } }, { sourceRef: { kind: "being", id: 1 } },
      { size: 0 }, { rotation: Infinity }, { position: { x: NaN, y: 1 } }, { sourceRef: null }]) {
      const doc = upgradeMapDocumentV5(oldDocument());
      const gp = doc.layers[0];
      if (gp.kind === "gameplay") gp.items.push({ ...base, ...patch } as typeof base);
      expect(validateMapDocumentV6(doc).length).toBeGreaterThan(0);
    }
    const wrong = { ...base, appearance: { shape: "circle" as const, visual: { type: "entity-avatar" as const, source: { ...ref, kind: "location" as const } } } };
    expect(() => putGameplayToken(upgradeMapDocumentV5(oldDocument()), "gp", wrong)).toThrow();
    for (const assetId of ["https://example.test/a.png", "file:///a.png", "C:\\test.png", "../test.png", "data:image/png;base64,AA=="]) {
      expect(() => putGameplayToken(upgradeMapDocumentV5(oldDocument()), "gp", { ...base,
        appearance: { shape: "circle", visual: { type: "asset", assetId } } })).toThrow();
    }
  });
  it("IDs are global, locked/hidden layers reject placement, detach preserves appearance", () => {
    const doc = upgradeMapDocumentV5(oldDocument());
    expect(() => putGameplayToken(doc, "gp", createGameplayToken("path", ref, { x: 1, y: 1 }))).toThrow();
    const gp = doc.layers[0];
    if (gp.kind === "gameplay") gp.locked = true;
    expect(() => putGameplayToken(doc, "gp", createGameplayToken("a", ref, { x: 1, y: 1 }))).toThrow();
    const token = createGameplayToken("a", ref, { x: 1, y: 1 });
    expect(detachGameplayToken(token, "Test")).toMatchObject({ sourceRef: null, label: { mode: "custom", text: "Test" }, appearance: token.appearance });
  });
  it("future documents and unknown entity kinds cannot be parsed or downgraded", () => {
    expect(parseMapDocumentV6({ ...upgradeMapDocumentV5(oldDocument()), v: 7 }).ok).toBe(false);
    const doc = upgradeMapDocumentV5(oldDocument());
    const gp = doc.layers[0];
    if (gp.kind === "gameplay") gp.items.push({ id: "future", kind: "future" } as unknown as import("./v6").GameplayToken);
    expect(parseMapDocumentV6(doc).ok).toBe(false);
    expect(validateMapDocumentV6({ v: 6, layers: [null] } as unknown as MapDocumentV6).length).toBeGreaterThan(0);
  });
});
