// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokensOf } from "@shared/maps/core";
import { useTokenPlacement } from "./useTokenPlacement";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import type { ResolvedTokenSource } from "./tokenPlacement";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("./mapApi", () => ({ mapWorkspaceApi: { resolveSource: resolve } }));
const source: ResolvedTokenSource = { sourceRef: { kind: "being", uid: "11111111-1111-4111-8111-111111111111" }, id: 7, state: "active", name: "Тест", portrait_url: null, visual: { type: "builtin", key: "being" } };
beforeEach(() => { resolve.mockReset(); }); afterEach(cleanup);
function setup() {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 8, height: 8, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  let document = loaded.document;
  const commit = vi.fn((operation) => { document = operation(document); });
  const onError = vi.fn(), onPlaced = vi.fn();
  const hook = renderHook(({ mapId, enabled }) => useTokenPlacement({ mapId, enabled, getDocument: () => document, activeLayer: "", snap: true, center: () => ({ x: 3, y: 3 }), commit, onError, onPlaced }), { initialProps: { mapId: 1, enabled: true } });
  return { ...hook, commit, onError, document: () => document, replace: (next: typeof document) => { document = next; } };
}
describe("asynchronous placement lifecycle", () => {
  it("a superseded resolver cannot place the previous source", async () => {
    let finish!: (value: ResolvedTokenSource) => void;
    resolve.mockReturnValueOnce(new Promise((done) => { finish = done; })).mockResolvedValue(source);
    const h = setup(); let first!: Promise<void>;
    act(() => { first = h.result.current.begin({ type: "being", id: 7 }, { x: 1, y: 1 }); });
    await act(async () => { await h.result.current.begin({ type: "being", id: 7 }, { x: 5, y: 5 }); });
    await act(async () => { finish(source); await first; });
    expect(h.commit).toHaveBeenCalledOnce(); expect(tokensOf(h.document())[0].position).toEqual({ x: 5.5, y: 5.5 });
  });
  it("keeps only a ghost pending; drops once as one command and repeating resolves distinct IDs", async () => {
    let finish!: (value: ResolvedTokenSource) => void;
    resolve.mockReturnValue(new Promise((done) => { finish = done; }));
    const h = setup(); let request!: Promise<void>;
    act(() => { request = h.result.current.begin({ type: "being", id: 7 }, { x: 2.2, y: 4.2 }); });
    expect(h.result.current.pending?.source).toBeNull(); expect(tokensOf(h.document())).toEqual([]);
    await act(async () => { finish(source); await request; });
    expect(h.commit).toHaveBeenCalledTimes(1); expect(tokensOf(h.document())[0].position).toEqual({ x: 2.5, y: 4.5 });
    resolve.mockResolvedValue(source);
    await act(async () => { await h.result.current.begin({ type: "being", id: 7 }, { x: 2, y: 4 }); });
    expect(new Set(tokensOf(h.document()).map((token) => token.id)).size).toBe(2);
  });
  it.each(["cancel", "map-change", "disable", "unmount"])("late resolution after %s cannot commit", async (action) => {
    let finish!: (value: ResolvedTokenSource) => void;
    resolve.mockReturnValue(new Promise((done) => { finish = done; }));
    const h = setup(); let request!: Promise<void>;
    act(() => { request = h.result.current.begin({ type: "being", id: 7 }, { x: 1, y: 1 }); });
    if (action === "cancel") act(() => h.result.current.cancel());
    else if (action === "unmount") h.unmount();
    else h.rerender({ mapId: action === "map-change" ? 2 : 1, enabled: action !== "disable" });
    await act(async () => { finish(source); await request; }); expect(h.commit).not.toHaveBeenCalled();
  });
  it("keyboard/button mode waits for confirmation and allows nudging without touching history", async () => {
    resolve.mockResolvedValue(source); const h = setup();
    await act(async () => { await h.result.current.begin({ type: "being", id: 7 }); });
    expect(h.commit).not.toHaveBeenCalled();
    act(() => h.result.current.nudge(1, 0));
    expect(h.result.current.pending?.position).toEqual({ x: 4.5, y: 3.5 });
    act(() => h.result.current.confirm());
    expect(h.commit).toHaveBeenCalledTimes(1); expect(tokensOf(h.document())[0].position).toEqual({ x: 4.5, y: 3.5 });
  });
  it("resolution failure and locking the target during resolution leave no token", async () => {
    resolve.mockRejectedValue(Error("Источник недоступен")); const h = setup();
    await act(async () => { await h.result.current.begin({ type: "being", id: 7 }, { x: 1, y: 1 }); });
    expect(h.onError).toHaveBeenCalledOnce(); expect(h.commit).not.toHaveBeenCalled();
    let finish!: (value: ResolvedTokenSource) => void; resolve.mockReturnValue(new Promise((done) => { finish = done; })); let request!: Promise<void>;
    act(() => { request = h.result.current.begin({ type: "being", id: 7 }, { x: 1, y: 1 }); });
    h.replace({ ...h.document(), layers: h.document().layers.map((layer) => layer.kind === "gameplay" ? { ...layer, locked: true } : layer) });
    await act(async () => { finish(source); await request; });
    expect(h.commit).not.toHaveBeenCalled(); expect(h.result.current.pending).toBeNull(); expect(tokensOf(h.document())).toEqual([]);
  });
});
