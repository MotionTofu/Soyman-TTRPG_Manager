// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMapDocumentV6, type MapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { createTerrainMaskLayer } from "../core/mutations/layers";
import { useMapHistory } from "../editor/hooks/useMapHistory";
import { editGeometry } from "./editDocument";
import { useWorkspaceGestures, type Gesture } from "./useWorkspaceGestures";

let frames: Map<number, FrameRequestCallback>, id: number;
beforeEach(() => {
  frames = new Map(); id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => { frames.delete(handle); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup() {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 12, height: 12, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  const initial = editGeometry(loaded.document, d => createTerrainMaskLayer(d, { id: "surface", name: "Surface" }));
  const record = { calls: 0 }, target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const hook = renderHook(() => {
    const [document, setState] = useState(initial), documentRef = useRef(document), gesture = useRef<Gesture | null>(null), space = useRef(false);
    const setDocument = (next: MapDocumentV6) => { record.calls++; documentRef.current = next; setState(next); };
    const history = useMapHistory({ value: document, getValue: () => documentRef.current, onChange: setDocument, clone: d => structuredClone(d) });
    const args = { doc: { documentRef, setDocument, history, autosave: { schedule: vi.fn(), status: { kind: "saved" } }, disabled: false, showError: (error: unknown) => { throw error; } },
      gesture, space, camera: { cam: { ox: 0, oy: 0, scale: 24 }, toWorld: (e: { clientX: number; clientY: number }) => ({ wx: e.clientX, wy: e.clientY }) },
      tool: "surface", activeLayer: "surface", settings: { material: "earth", radius: .3 }, selections: [], selection: null, setSelection: vi.fn(), setSelections: vi.fn(), setActiveLayer: vi.fn(), snap: false, placement: { pending: null }, busy: false, onLabel: vi.fn() };
    return { gestures: useWorkspaceGestures(args as unknown as Parameters<typeof useWorkspaceGestures>[0]), document, history };
  });
  const event = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, currentTarget: target }) as unknown as Parameters<typeof hook.result.current.gestures.down>[0];
  const frame = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(16)); });
  return { ...hook, initial, event, frame, record };
}
describe("batched surface gestures", () => {
  it("applies multiple pointer events once per frame and flushes the last segment into one undo/redo step", () => {
    const t = setup();
    act(() => t.result.current.gestures.down(t.event(1, 1)));
    const afterDown = t.record.calls;
    act(() => { t.result.current.gestures.move(t.event(6, 1)); t.result.current.gestures.move(t.event(6, 6)); });
    expect(t.record.calls).toBe(afterDown); expect(frames.size).toBe(1);
    t.frame(); expect(t.record.calls).toBe(afterDown + 1);
    act(() => t.result.current.gestures.move(t.event(9, 6)));
    act(() => t.result.current.gestures.up(t.event(9, 9)));
    expect(frames.size).toBe(0); expect(t.result.current.history.canUndo).toBe(true);
    const painted = serializeMapDocumentV6(t.result.current.document);
    act(() => t.result.current.history.undo());
    expect(serializeMapDocumentV6(t.result.current.document)).toBe(serializeMapDocumentV6(t.initial));
    expect(t.result.current.history.canUndo).toBe(false);
    act(() => t.result.current.history.redo()); expect(serializeMapDocumentV6(t.result.current.document)).toBe(painted);
  });
  it("discards a queued segment on Escape and on unmount, without a late write", () => {
    const t = setup();
    act(() => { t.result.current.gestures.down(t.event(1, 1)); t.result.current.gestures.move(t.event(6, 1)); });
    act(() => t.result.current.gestures.finishGesture(true));
    expect(frames.size).toBe(0); t.frame();
    expect(serializeMapDocumentV6(t.result.current.document)).toBe(serializeMapDocumentV6(t.initial));
    expect(t.result.current.history.canUndo).toBe(false);
    act(() => { t.result.current.gestures.down(t.event(2, 2)); t.result.current.gestures.move(t.event(7, 2)); });
    const beforeUnmount = t.record.calls; t.unmount(); t.frame();
    expect(frames.size).toBe(0); expect(t.record.calls).toBe(beforeUnmount);
  });
});
