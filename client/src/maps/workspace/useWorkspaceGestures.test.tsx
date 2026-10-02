// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { addSymbol, type WorkspaceSelection, type WorkspaceTool } from "./editorCommands";
import { useWorkspaceGestures, type Gesture } from "./useWorkspaceGestures";
import type { BrushSettings } from "./ToolSettings";

function setup(initialTool: WorkspaceTool = "select", snap = false, initialSettings: Partial<BrushSettings> = {}) {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 12, height: 12, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  let document = { ...loaded.document, layers: [...loaded.document.layers, { id: "objects", name: "Objects", kind: "object" as const, visible: true, locked: false, opacity: 1, items: [] }] };
  document = addSymbol(document, "objects", "a", { x: 2, y: 2 }, "soyman-symbols:tree");
  document = addSymbol(document, "objects", "b", { x: 4, y: 3 }, "soyman-symbols:tree");
  document = { ...document, layers: [...document.layers, { id: "walls", name: "Стены", kind: "path", visible: true, locked: false, opacity: 1, paths: [] }] };
  const documentRef = { current: document }, setDocument = vi.fn(next => { documentRef.current = next; });
  const push = vi.fn(), schedule = vi.fn();
  const commit = vi.fn(edit => { const before = documentRef.current, next = edit(before); if (next !== before) { push(before); setDocument(next); schedule(); } });
  const hook = renderHook(() => {
    const [selections, setSelections] = useState<WorkspaceSelection[]>([]);
    const [tool, setTool] = useState(initialTool);
    const [settings, setSettings] = useState<Partial<BrushSettings>>({ material: "stone", cellSize: 1, lineWidth: .3, ...initialSettings });
    const gesture = useRef<Gesture | null>(null), space = useRef(false);
    const args = {
      doc: { documentRef, setDocument, commit, history: { push, beginStroke: vi.fn(), markStrokeChanged: vi.fn(), commitStroke: vi.fn(), cancelStroke: vi.fn() }, autosave: { schedule, status: { kind: "saved" } }, disabled: false, showError: vi.fn() },
      gesture, space, camera: { cam: { ox: 0, oy: 0, scale: 24 }, toWorld: (event: { clientX: number; clientY: number }) => ({ wx: event.clientX, wy: event.clientY }) },
      tool, activeLayer: tool === "wall" || tool === "road" || tool === "river" ? "walls" : tool === "brush" || tool === "eraser" ? documentRef.current.layers.find(l => l.kind === "terrain")!.id : "objects", setActiveLayer: vi.fn(), snap, settings,
      selection: selections.length === 1 ? selections[0] : null, selections, setSelections,
      setSelection: (entry: WorkspaceSelection | null) => setSelections(entry ? [entry] : []),
      placement: { pending: null }, busy: false, onLabel: vi.fn(),
    } as unknown as Parameters<typeof useWorkspaceGestures>[0];
    return { ...useWorkspaceGestures(args), selections, setTool, setSettings };
  });
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const event = (x: number, y: number, shiftKey = false) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey, currentTarget: target }) as unknown as Parameters<typeof hook.result.current.down>[0];
  return { ...hook, event, documentRef, setDocument, push, schedule };
}
describe("selection gestures", () => {
  it.each(["road", "river"] as const)("creates %s with manual points, ignores the hover point, and can close or cancel", tool => {
    const t = setup(tool, false, { pathMode: "points" });
    for (const [x, y] of [[1, 1], [5, 2], [6, 6]]) {
      act(() => t.result.current.down(t.event(x, y)));
      act(() => t.result.current.up(t.event(x, y)));
    }
    act(() => t.result.current.move(t.event(9, 9)));
    expect(t.setDocument).not.toHaveBeenCalled();
    act(() => t.result.current.finishWall());
    const layer = t.documentRef.current.layers.find(l => l.id === "walls");
    expect(layer?.kind === "path" && layer.paths[0]).toMatchObject({ kind: tool, geometry: { nodes: [
      { position: { x: 1, y: 1 }, out: expect.any(Object) }, { position: { x: 5, y: 2 }, in: expect.any(Object), out: expect.any(Object) }, { position: { x: 6, y: 6 }, in: expect.any(Object) },
    ] } });
    expect(t.push).toHaveBeenCalledOnce();
    for (const [x, y] of [[2, 2], [7, 2], [7, 7], [2, 2]]) act(() => t.result.current.down(t.event(x, y)));
    const closedLayer = t.documentRef.current.layers.find(l => l.id === "walls");
    expect(closedLayer?.kind === "path" && closedLayer.paths[1]).toMatchObject({ kind: tool, properties: { closed: true } });
    act(() => t.result.current.down(t.event(8, 8)));
    act(() => t.result.current.finishGesture(true));
    expect(t.push).toHaveBeenCalledTimes(2);
  });
  it.each(["road", "river"] as const)("keeps freehand drawing available for %s", tool => {
    const t = setup(tool, false, { pathMode: "brush" });
    act(() => t.result.current.down(t.event(1, 1)));
    act(() => t.result.current.move(t.event(4, 3)));
    act(() => t.result.current.up(t.event(6, 6)));
    const layer = t.documentRef.current.layers.find(l => l.id === "walls");
    expect(layer?.kind === "path" && layer.paths[0]).toMatchObject({ kind: tool, geometry: { nodes: [{ position: { x: 1, y: 1 } }, { position: { x: 4, y: 3 } }, { position: { x: 6, y: 6 } }] } });
    expect(t.push).toHaveBeenCalledOnce();
  });

  it.each(["wall", "road", "river"] as const)("selects %s nodes with Shift and moves selected nodes together in one undo step", tool => {
    const t = setup(tool, false, { pathMode: "points" });
    for (const [x, y] of [[1, 1], [5, 1], [5, 5]]) {
      act(() => t.result.current.down(t.event(x, y)));
      act(() => t.result.current.up(t.event(x, y)));
    }
    act(() => t.result.current.finishWall());
    act(() => t.result.current.setTool("select"));
    act(() => t.result.current.down(t.event(1, 1)));
    act(() => t.result.current.up(t.event(1, 1)));
    expect(t.result.current.selectedNodes).toEqual([0]);
    act(() => t.result.current.down(t.event(5, 1, true)));
    act(() => t.result.current.up(t.event(5, 1, true)));
    expect(t.result.current.selectedNodes).toEqual([0, 1]);
    t.push.mockClear();
    act(() => t.result.current.down(t.event(1, 1)));
    act(() => t.result.current.move(t.event(2, 2)));
    act(() => t.result.current.up(t.event(2, 2)));
    const layer = t.documentRef.current.layers.find(l => l.id === "walls");
    expect(layer?.kind === "path" && layer.paths[0].geometry).toMatchObject({ nodes: [
      { position: { x: 2, y: 2 } }, { position: { x: 6, y: 2 } }, { position: { x: 5, y: 5 } },
    ] });
    expect(t.push).toHaveBeenCalledOnce();
    act(() => t.result.current.down(t.event(6, 2, true)));
    act(() => t.result.current.up(t.event(6, 2, true)));
    expect(t.result.current.selectedNodes).toEqual([0]);
  });

  it("does not turn an empty interior click into a marquee selecting the enclosing wall", () => {
    const t = setup();
    act(() => t.result.current.setTool("wall"));
    for (const [x, y] of [[1, 1], [9, 1], [9, 9], [1, 9]]) {
      act(() => t.result.current.down(t.event(x, y)));
      act(() => t.result.current.up(t.event(x, y)));
    }
    act(() => t.result.current.finishWall(true));
    act(() => t.result.current.setTool("select"));
    act(() => t.result.current.down(t.event(6, 6)));
    act(() => t.result.current.up(t.event(6, 6)));
    expect(t.result.current.selections).toEqual([]);
    act(() => t.result.current.down(t.event(1, 5)));
    act(() => t.result.current.up(t.event(1, 5)));
    expect(t.result.current.selections).toHaveLength(1);
    expect(t.result.current.selections[0].kind).toBe("path");
    act(() => t.result.current.down(t.event(6, 6)));
    act(() => t.result.current.up(t.event(6.01, 6.01)));
    expect(t.result.current.selections).toEqual([]);
  });
  it("fills and clears a cell rectangle as one edit per drag, and can cancel the rectangle", () => {
    const t = setup("brush", false, { cellMode: "area" });
    act(() => t.result.current.down(t.event(1.2, 1.2)));
    act(() => t.result.current.move(t.event(4.7, 2.8)));
    expect(t.setDocument).not.toHaveBeenCalled();
    expect(t.result.current.preview).toEqual({ x: 1, y: 1, w: 4, h: 2 });
    act(() => t.result.current.up(t.event(4.7, 2.8)));
    const terrain = t.documentRef.current.layers.find(l => l.kind === "terrain");
    expect(terrain?.kind === "terrain" && terrain.representation === "cells" && terrain.cells.length).toBe(8);
    expect(t.push).toHaveBeenCalledTimes(1);
    act(() => t.result.current.setTool("eraser"));
    act(() => t.result.current.down(t.event(1.2, 1.2)));
    act(() => t.result.current.move(t.event(4.7, 2.8)));
    act(() => t.result.current.finishGesture(true));
    expect(t.push).toHaveBeenCalledTimes(1);
    act(() => t.result.current.down(t.event(1.2, 1.2)));
    act(() => t.result.current.up(t.event(4.7, 2.8)));
    const erased = t.documentRef.current.layers.find(l => l.kind === "terrain");
    expect(erased?.kind === "terrain" && erased.representation === "cells" && erased.cells.length).toBe(0);
    expect(t.push).toHaveBeenCalledTimes(2);
  });
  it("previews the actual cell brush footprint without painting on pointer movement", () => {
    const t = setup("brush", false, { cellSize: 3 });
    act(() => t.result.current.move(t.event(5.5, 5.5)));
    expect(t.result.current.cellBrush).toHaveLength(9);
    expect(t.setDocument).not.toHaveBeenCalled();
    act(() => t.result.current.leave());
    expect(t.result.current.cellBrush).toBeNull();
  });
  it("places linear wall points by clicks, previews the cursor without saving it, and closes on the first point", () => {
    const t = setup("wall", true);
    for (const [x, y] of [[1.1, 1.1], [5.1, 1.1], [5.1, 5.1], [1.1, 5.1]]) {
      act(() => t.result.current.down(t.event(x, y)));
      act(() => t.result.current.up(t.event(x, y)));
    }
    expect(t.setDocument).not.toHaveBeenCalled();
    act(() => t.result.current.move(t.event(1.1, 1.1)));
    expect(t.result.current.wallDraft?.closing).toBe(true);
    act(() => t.result.current.down(t.event(1.1, 1.1)));
    expect(t.documentRef.current.layers.find(l => l.id === "walls")).toMatchObject({ paths: [{ kind: "wall", properties: { closed: true }, geometry: { nodes: [
      { position: { x: 1, y: 1 } }, { position: { x: 5, y: 1 } }, { position: { x: 5, y: 5 } }, { position: { x: 1, y: 5 } },
    ] } }] });
    expect(t.result.current.wallDraft).toBeNull();
    expect(t.push).toHaveBeenCalledTimes(1);
  });
  it("finishes only clicked wall points and cancels an unfinished wall without editing the document", () => {
    const t = setup("wall");
    act(() => t.result.current.down(t.event(1, 1)));
    act(() => t.result.current.down(t.event(5, 1)));
    act(() => t.result.current.move(t.event(7, 7)));
    act(() => t.result.current.finishWall());
    expect(t.documentRef.current.layers.find(l => l.id === "walls")).toMatchObject({ paths: [{ properties: { closed: false }, geometry: { nodes: [{ position: { x: 1, y: 1 } }, { position: { x: 5, y: 1 } }] } }] });
    act(() => t.result.current.down(t.event(2, 2)));
    act(() => t.result.current.down(t.event(6, 2)));
    act(() => t.result.current.finishGesture(true));
    expect(t.push).toHaveBeenCalledTimes(1);
    expect(t.setDocument).toHaveBeenCalledTimes(1);
  });
  it("selects by marquee without changing the map, then moves the group in one undo step", () => {
    const t = setup();
    act(() => t.result.current.down(t.event(0, 0)));
    act(() => t.result.current.move(t.event(5, 4)));
    act(() => t.result.current.up(t.event(5, 4)));
    expect(t.result.current.selections.map(entry => entry.id)).toEqual(["a", "b"]);
    expect(t.result.current.marquee).toBeNull();
    expect(t.setDocument).not.toHaveBeenCalled();
    expect(t.push).not.toHaveBeenCalled();
    expect(t.schedule).not.toHaveBeenCalled();
    act(() => t.result.current.down(t.event(2, 2)));
    act(() => t.result.current.move(t.event(3, 4)));
    act(() => t.result.current.up(t.event(3, 4)));
    const layer = t.documentRef.current.layers.find(entry => entry.id === "objects");
    expect(layer?.kind === "object" && layer.items.map(item => item.transform.position)).toEqual([{ x: 3, y: 4 }, { x: 5, y: 5 }]);
    expect(t.push).toHaveBeenCalledTimes(1);
  });
  it("toggles Shift-click selection and restores the previous selection when a marquee is cancelled", () => {
    const t = setup();
    act(() => t.result.current.down(t.event(2, 2, true)));
    act(() => t.result.current.up(t.event(2, 2, true)));
    act(() => t.result.current.down(t.event(4, 3, true)));
    act(() => t.result.current.up(t.event(4, 3, true)));
    expect(t.result.current.selections).toHaveLength(2);
    act(() => t.result.current.down(t.event(2, 2, true)));
    act(() => t.result.current.up(t.event(2, 2, true)));
    expect(t.result.current.selections.map(entry => entry.id)).toEqual(["b"]);
    act(() => t.result.current.down(t.event(0, 0)));
    act(() => t.result.current.move(t.event(3, 3)));
    act(() => t.result.current.finishGesture(true));
    expect(t.result.current.selections.map(entry => entry.id)).toEqual(["b"]);
    expect(t.setDocument).not.toHaveBeenCalled();
  });
});
