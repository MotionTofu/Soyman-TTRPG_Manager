import { expect, it } from "vitest";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { createTerrainMaskLayer } from "../core/mutations/layers";
import { paintSurface } from "../workspace/artisticCommands";
import { editGeometry } from "../workspace/editDocument";
import { createWorkspaceRenderModel } from "../workspace/renderV6";
import { waterSources } from "./waterFilter";
import type { MapRenderModel, RenderPath } from "../renderModel";

it("смена течения реки пересобирает маску воды", () => {
  const nodes = [{ position: { x: 1, y: 1 } }, { position: { x: 9, y: 1 } }];
  const sources = (flow?: RenderPath["flow"]) => waterSources({ layers: [{ kind: "path", visible: true,
    paths: [{ kind: "river", cells: new Set(), nodes, width: 1, style: "village-river", ...(flow ? { flow } : {}) }] }] } as unknown as MapRenderModel, 10, 10);
  const forward = sources();
  expect(sources().every((source, i) => source === forward[i])).toBe(true);
  expect(sources("back").some((source, i) => source !== forward[i])).toBe(true);
  const model = { layers: [] } as unknown as MapRenderModel;
  expect(waterSources(model, 10, 10, 2)).not.toEqual(waterSources(model, 10, 10));
});

it("маска воды не пересобирается, пока двигают подпись, и пересобирается после мазка по поверхности", () => {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 60, height: 40, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  const masked = paintSurface(editGeometry(loaded.document, view => createTerrainMaskLayer(view, { id: "mask", name: "Surface" })), "mask", { x: 5, y: 5 }, { x: 5, y: 5 }, 1, "village-deep");
  const label = (doc: typeof masked, x: number) => ({ ...doc, layers: [...doc.layers, { id: "labels2", name: "Подписи", kind: "label" as const, visible: true, locked: false, opacity: 1, items: [{ id: "a", position: { x, y: 10 }, text: "Тут" }] }] });
  const sources = (doc: typeof masked) => waterSources(createWorkspaceRenderModel(doc).model, 60, 40);
  const before = sources(label(masked, 10));
  expect(before.length).toBeGreaterThan(2);
  expect(sources(label(masked, 12))).toEqual(before);
  expect(sources(label(masked, 12)).every((source, i) => source === before[i])).toBe(true);
  const repainted = sources(label(paintSurface(masked, "mask", { x: 20, y: 20 }, { x: 20, y: 20 }, 1, "village-deep"), 10));
  expect(repainted.some((source, i) => source !== before[i])).toBe(true);
});
