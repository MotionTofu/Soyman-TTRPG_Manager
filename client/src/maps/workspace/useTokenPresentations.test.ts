// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameplayToken, putGameplayToken, type MapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { tokenTarget, type TokenPresentation } from "./tokenPlacement";
import { useTokenPresentations } from "./useTokenPresentations";
const present = vi.hoisted(() => vi.fn());
vi.mock("./mapApi", () => ({ mapWorkspaceApi: { presentations: present } }));
vi.mock("../../api/client", () => ({ getAuthToken: () => "test-token" }));
vi.mock("../../dataSync", () => ({ onDataChangedElsewhere: () => () => {} }));
const ref = { kind: "being" as const, uid: "11111111-1111-4111-8111-111111111111" };
const row: TokenPresentation = { sourceRef: ref, id: 7, state: "active", name: "Тестовое имя", portrait_url: null };
function fixture() {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 8, height: 8, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  return putGameplayToken(loaded.document, tokenTarget(loaded.document, ""), createGameplayToken("t", ref, { x: 2, y: 2 }));
}
beforeEach(() => { present.mockReset(); }); afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("transient token presentations", () => {
  it("keeps portraits visible during refresh and reuses unchanged images", async () => {
    const decode = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("Image", class { src = ""; decode = decode; });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:portrait"), revokeObjectURL: vi.fn() });
    const fetchImage = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["portrait"]) });
    vi.stubGlobal("fetch", fetchImage);
    const portraitRow = { ...row, portrait_url: "/files/portrait.webp" };
    present.mockResolvedValueOnce([portraitRow]);
    const hook = renderHook(() => useTokenPresentations(1, fixture()));
    const key = `being:${ref.uid}`;
    await waitFor(() => expect(hook.result.current.get(key)?.portrait).toBeDefined());
    const portrait = hook.result.current.get(key)!.portrait;
    let finish!: (rows: TokenPresentation[]) => void;
    present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(present).toHaveBeenCalledTimes(2));
    expect(hook.result.current.get(key)?.portrait).toBe(portrait);
    await act(async () => finish([{ ...portraitRow, name: "Новое имя" }]));
    expect(hook.result.current.get(key)).toMatchObject({ name: "Новое имя", portrait });
    expect(fetchImage).toHaveBeenCalledOnce();
    present.mockRejectedValueOnce(Error("offline"));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(present).toHaveBeenCalledTimes(3));
    expect(hook.result.current.get(key)).toMatchObject({ name: "Новое имя", portrait });
  });

  it("requests unique source refs, geometry changes do not refetch or write display metadata", async () => {
    present.mockResolvedValue([row]); const doc = fixture();
    const hook = renderHook(({ doc }) => useTokenPresentations(1, doc), { initialProps: { doc } });
    await waitFor(() => expect(hook.result.current.get(`being:${ref.uid}`)?.name).toBe(row.name));
    const two = putGameplayToken(doc, tokenTarget(doc, ""), createGameplayToken("second", ref, { x: 4, y: 4 })); hook.rerender({ doc: two });
    expect(present).toHaveBeenCalledOnce(); expect(present).toHaveBeenCalledWith(1, [ref]);
    expect(JSON.stringify(two)).not.toContain(row.name);
  });
  it("late response for another map cannot expose stale presentation", async () => {
    let finish!: (rows: TokenPresentation[]) => void;
    present.mockImplementationOnce(() => new Promise((done) => { finish = done; })).mockResolvedValue([{ ...row, name: "Вторая карта" }]);
    const hook = renderHook(({ mapId }) => useTokenPresentations(mapId, fixture()), { initialProps: { mapId: 1 } });
    hook.rerender({ mapId: 2 });
    await waitFor(() => expect(hook.result.current.get(`being:${ref.uid}`)?.name).toBe("Вторая карта"));
    await act(async () => finish([row])); expect(hook.result.current.get(`being:${ref.uid}`)?.name).toBe("Вторая карта");
  });
  it("failed portrait loading retains a usable source name and the canonical document", async () => {
    const fetchImage = vi.fn().mockRejectedValue(Error("image unavailable")); vi.stubGlobal("fetch", fetchImage);
    present.mockResolvedValue([{ ...row, portrait_url: "/files/test.png" }]); const doc = fixture(), raw = JSON.stringify(doc);
    const hook = renderHook(() => useTokenPresentations(1, doc));
    await waitFor(() => expect(fetchImage).toHaveBeenCalledOnce());
    expect(hook.result.current.get(`being:${ref.uid}`)).toMatchObject({ name: row.name, state: "active" });
    expect(hook.result.current.get(`being:${ref.uid}`)?.portrait).toBeUndefined(); expect(JSON.stringify(doc)).toBe(raw);
  });
  it("failed source loading shows a neutral fallback without changing the document", async () => {
    present.mockRejectedValue(Error("offline")); const doc: MapDocumentV6 = fixture();
    const hook = renderHook(() => useTokenPresentations(1, doc));
    await waitFor(() => expect(hook.result.current.get(`being:${ref.uid}`)?.state).toBe("missing"));
    expect(hook.result.current.get(`being:${ref.uid}`)?.id).toBeNull();
  });
});
