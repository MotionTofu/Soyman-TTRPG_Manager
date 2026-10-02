// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { addWall } from "./walls";
import { selectedPath, addFreePath } from "./artisticCommands";
import { ArtProperties } from "./ArtProperties";

afterEach(cleanup);
it.each(["wall", "road", "river"] as const)("applies width to selected %s nodes and inserts midpoints only between selected endpoints", kind => {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 8, height: 8, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  const base: MapDocumentV6 = { ...loaded.document, layers: [...loaded.document.layers, { id: "walls", name: "Линии", kind: "path", visible: true, locked: false, opacity: 1, paths: [] }] };
  const anchors = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }];
  let doc = kind === "wall" ? addWall(base, "walls", anchors, .36) : addFreePath(base, "walls", anchors, kind, .36);
  const layer = doc.layers.find(layer => layer.id === "walls");
  if (layer?.kind !== "path") throw Error("fixture");
  const selection = { layerId: "walls", id: layer.paths[0].id, kind: "path" as const };
  const onSelectedNodes = vi.fn();
  const props = { selection, selectedNodes: [0, 1], onSelectedNodes, commit: (edit: (before: MapDocumentV6) => MapDocumentV6) => { doc = edit(doc); }, onClose: vi.fn(), onDelete: vi.fn() };
  const view = render(<ArtProperties document={doc} {...props} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: kind === "wall" ? "Толщина выбранных точек стены" : "Толщина выбранных точек линии" }), { target: { value: "1.2" } });
  const path = selectedPath(doc, selection)!;
  expect(path.geometry.type === "spline" && path.geometry.nodes.map(node => node.width)).toEqual([1.2, 1.2, undefined]);
  view.rerender(<ArtProperties document={doc} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Добавить точки" }));
  const updated = selectedPath(doc, selection)!;
  expect(updated.geometry.type === "spline" && updated.geometry.nodes[1]).toMatchObject({ width: 1.2 });
  expect(onSelectedNodes).toHaveBeenCalledWith([1]);
});
