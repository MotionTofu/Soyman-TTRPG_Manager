import { describe, expect, it } from "vitest";
import { createGameplayToken, tokensOf, upgradeMapDocumentV5 } from "@shared/maps/core";
import { buildMasterSoyMapV3, parseSoyMapV3, importSoyMapV3 } from "./exchangeV3";
import { buildSoyMapV2 } from "./exchangeV2";
import { loadStoredEditorDocument, loadStoredWorkspaceDocument } from "../editor/loadDocument";

const stored = { cells: '{"v":1,"cells":{"1,1":"stone"},"roads":[]}', grid: "square" as const, width: 8, height: 8 };
const meta = { name: "Test map", scale: "locality" as const, cellLore: "5 м" };
function fixture() {
  const loaded = loadStoredWorkspaceDocument(stored);
  if (loaded.status !== "supported") throw new Error("fixture");
  loaded.document.layers.push({ id: "token-layer", kind: "gameplay", name: "Test", visible: true, locked: false, opacity: 1,
    items: [createGameplayToken("test-token", { kind: "location", uid: "12345678-1234-1234-1234-123456789abc" }, { x: 2.5, y: 3.5 })] });
  return buildMasterSoyMapV3(meta, loaded.document);
}
describe("soyman-map/3", () => {
  it("master round-trip preserves refs; default import detaches them without name matching", () => {
    const master = fixture();
    const raw = JSON.parse(JSON.stringify(master));
    expect(parseSoyMapV3(raw)).toEqual({ ok: true, value: master });
    const imported = importSoyMapV3(raw);
    if (!imported.ok) throw new Error("import");
    expect(tokensOf(imported.value.document)[0]).toMatchObject({ id: "test-token", sourceRef: null,
      position: { x: 2.5, y: 3.5 }, label: { mode: "custom", text: "Без связи" }, playerVisibility: "private" });
    expect(tokensOf(master.document)[0].sourceRef).not.toBeNull();
  });
  it("reads /1 and /2 through their validated migration paths", () => {
    const v1 = { format: "soyman-map/1", ...stored, name: meta.name, scale: meta.scale, cell_lore: meta.cellLore };
    const old = loadStoredEditorDocument(stored).document;
    for (const input of [v1, buildSoyMapV2(meta, old)]) {
      const loaded = importSoyMapV3(input);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
      expect(loaded.value.document).toEqual(upgradeMapDocumentV5(old));
    }
  });
  it("future envelope/doc versions and invalid refs do not downgrade", () => {
    const env = fixture();
    expect(importSoyMapV3({ ...env, format: "soyman-map/4" }).ok).toBe(false);
    expect(parseSoyMapV3({ ...env, document: { ...env.document, v: 7 } }).ok).toBe(false);
    tokensOf(env.document)[0].sourceRef = { kind: "location", uid: "invalid" };
    expect(parseSoyMapV3(env).ok).toBe(false);
  });
});
