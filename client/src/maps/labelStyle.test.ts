import { expect, it } from "vitest";
import { parseMapDocumentV6, serializeMapDocumentV6, validateMapDocumentV6, type MapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "./editor/loadDocument";
import { updateLabelStyle } from "./core/mutations/labels";
import { editGeometry } from "./workspace/editDocument";
import { createWorkspaceRenderModel } from "./workspace/renderV6";
import { labelBox } from "./labelStyle";

function fixture(): MapDocumentV6 {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 20, height: 10, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  return { ...loaded.document, layers: [...loaded.document.layers, { id: "names", name: "Подписи", kind: "label", visible: true, locked: false, opacity: 1, items: [{ id: "a", position: { x: 5, y: 5 }, text: "Орашное" }] }] };
}
const label = (doc: MapDocumentV6) => { const layer = doc.layers.find(l => l.id === "names"); if (layer?.kind !== "label") throw Error("fixture"); return layer.items[0]; };

it("вид подписи хранится в карте, переживает сохранение и доходит до отрисовки; пустой вид не хранится", () => {
  const styled = editGeometry(fixture(), view => updateLabelStyle(view, "a", { font: "caveat", size: 1.5, bold: true, color: "#aa2200", italic: undefined }));
  expect(label(styled).style).toEqual({ font: "caveat", size: 1.5, bold: true, color: "#aa2200" });
  const parsed = parseMapDocumentV6(serializeMapDocumentV6(styled));
  expect(parsed.ok && label(parsed.value).style).toEqual({ bold: true, color: "#aa2200", font: "caveat", size: 1.5 });
  expect(createWorkspaceRenderModel(styled).model.layers.find(l => l.id === "names")).toMatchObject({ labels: [{ style: { size: 1.5 } }] });
  expect(labelBox(label(styled)).w).toBeGreaterThan(labelBox(label(fixture())).w);
  expect("style" in label(editGeometry(styled, view => updateLabelStyle(view, "a", {})))).toBe(false);
  const bad = { ...styled, layers: styled.layers.map(l => l.id === "names" && l.kind === "label" ? { ...l, items: [{ ...l.items[0], style: { size: 500, color: "red" } }] } : l) };
  expect(validateMapDocumentV6(bad).map(issue => issue.code)).toContain("label.bad-style");
});

it("рамка карты хранится в оформлении и проверяется", () => {
  const framed: MapDocumentV6 = { ...fixture(), appearance: { style: "comic-punk", frame: 3 } };
  const parsed = parseMapDocumentV6(serializeMapDocumentV6(framed));
  expect(parsed.ok && parsed.value.appearance).toEqual({ style: "comic-punk", frame: 3 });
  expect(validateMapDocumentV6({ ...framed, appearance: { style: "comic-punk", frame: -1 } }).map(issue => issue.code)).toContain("appearance.bad-frame");
});
