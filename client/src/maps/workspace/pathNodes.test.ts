import { describe, expect, it } from "vitest";
import { parseMapDocumentV6, serializeMapDocumentV6, type SplineNode, type Vec2 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { addFreePath, selectedPath, freePathHit } from "./artisticCommands";
import { insertPathNodes, setPathNodeWidth, setPathClosed } from "./pathNodes";
import { createWorkspaceRenderModel } from "./renderV6";

function fixture(kind: "road" | "river", closed = false) {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 12, height: 12, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  const base = { ...loaded.document, layers: [...loaded.document.layers, { id: "paths", name: "Линии", kind: "path" as const, visible: true, locked: false, opacity: 1, paths: [] }] };
  const doc = addFreePath(base, "paths", [{ x: 1, y: 1 }, { x: 5, y: 3 }, { x: 6, y: 8 }], kind, .3, closed);
  const layer = doc.layers.find(l => l.id === "paths");
  if (layer?.kind !== "path") throw Error("fixture");
  return { doc, selection: { id: layer.paths[0].id, layerId: "paths", kind: "path" as const } };
}
function bezier(a: SplineNode, b: SplineNode, t: number): Vec2 {
  const p = [a.position, a.out!, b.in!, b.position], k = [Math.pow(1 - t, 3), 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3];
  return { x: p.reduce((sum, v, i) => sum + v.x * k[i], 0), y: p.reduce((sum, v, i) => sum + v.y * k[i], 0) };
}
describe("Bezier node editing", () => {
  it("closing an existing open curve creates editable closing handles without disturbing existing ones", () => {
    const { doc, selection } = fixture("road");
    const before = selectedPath(doc, selection)!;
    const closed = setPathClosed(doc, selection, true);
    const after = selectedPath(closed, selection)!;
    if (before.geometry.type !== "spline" || after.geometry.type !== "spline") throw Error("fixture");
    expect(after.geometry.nodes[0].in).toBeDefined();
    expect(after.geometry.nodes.at(-1)!.out).toBeDefined();
    expect(after.geometry.nodes[0].out).toEqual(before.geometry.nodes[0].out);
    expect(after.geometry.nodes.at(-1)!.in).toEqual(before.geometry.nodes.at(-1)!.in);
    expect(after.properties?.closed).toBe(true);
    expect(selectedPath(setPathClosed(closed, selection, false), selection)?.properties?.closed).toBe(false);
  });

  it.each(["road", "river"] as const)("splits %s without changing its curve or width profile", kind => {
    const { doc, selection } = fixture(kind);
    const sized = setPathNodeWidth(doc, selection, [1], 1.2);
    const original = selectedPath(sized, selection)!;
    if (original.geometry.type !== "spline") throw Error("fixture");
    const { document, indices } = insertPathNodes(sized, selection, [0, 1, 2]);
    const path = selectedPath(document, selection)!;
    if (path.geometry.type !== "spline") throw Error("fixture");
    expect(indices).toEqual([1, 3]); expect(path.geometry.nodes).toHaveLength(5);
    expect(path.geometry.nodes[1].width).toBeCloseTo(.75);
    for (let edge = 0; edge < 2; edge++) for (const t of [0, .1, .35, .5, .7, 1]) {
      const before = bezier(original.geometry.nodes[edge], original.geometry.nodes[edge + 1], t);
      const offset = t <= .5 ? 0 : 1;
      const after = bezier(path.geometry.nodes[edge * 2 + offset], path.geometry.nodes[edge * 2 + offset + 1], t <= .5 ? t * 2 : t * 2 - 1);
      expect(after.x).toBeCloseTo(before.x, 8); expect(after.y).toBeCloseTo(before.y, 8);
    }
    expect(parseMapDocumentV6(serializeMapDocumentV6(document))).toMatchObject({ ok: true });
  });
  it("splits the closing Bezier segment and keeps its first-point handles intact", () => {
    const { doc, selection } = fixture("river", true);
    const before = selectedPath(doc, selection)!;
    const inserted = insertPathNodes(doc, selection, [0, 2]);
    const after = selectedPath(inserted.document, selection)!;
    if (before.geometry.type !== "spline" || after.geometry.type !== "spline") throw Error("fixture");
    const expected = bezier(before.geometry.nodes[2], before.geometry.nodes[0], .5);
    expect(after.geometry.nodes[3].position).toEqual(expected);
    expect(after.geometry.nodes[0].out).toEqual(before.geometry.nodes[0].out);
    expect(createWorkspaceRenderModel(inserted.document).model.layers.find(l => l.id === "paths")).toMatchObject({ paths: [{ closed: true }] });
  });
  it("uses local thickness when picking a tapered Bezier curve", () => {
    const nodes: SplineNode[] = [{ position: { x: 1, y: 1 }, out: { x: 2, y: 1 }, width: .2 }, { position: { x: 5, y: 1 }, in: { x: 4, y: 1 }, width: 2 }];
    expect(freePathHit(nodes, { x: 4.9, y: 1.8 }, .3, .05)).toBe(true);
    expect(freePathHit(nodes, { x: 1.1, y: 1.8 }, .3, .05)).toBe(false);
  });
});
