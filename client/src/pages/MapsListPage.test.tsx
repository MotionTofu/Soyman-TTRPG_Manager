// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MapsListPage } from "./MapsListPage";
import { ENTITY_MENU_EVENT } from "../pageMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
const mocks = vi.hoisted(() => ({ role: "gm", version: 1, post: vi.fn() }));
vi.mock("../api/currentUser", () => ({ useCurrentUser: () => ({ user: { role: mocks.role } }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...await importOriginal<typeof import("@tanstack/react-query")>(), useQueries: () => [] }));
vi.mock("../data/hooks", () => ({ useAction: () => vi.fn(), useAfterWrite: () => vi.fn(), resourceQuery: () => ({}), write: { post: mocks.post },
  useResource: (path: string | null) => path !== "/maps" ? { loading: false, data: undefined } : ({ loading: false, data: [{ id: 7, name: "Тестовая карта", grid: "hex", scale: "continent", width: 40, height: 30, updated_at: "2026-09-30", document_version: mocks.version, player_visible: 0 }] }) }));
vi.mock("../hooks/useConfirm", () => ({ useConfirm: () => [null, vi.fn()], useAlert: () => [null, vi.fn()] }));
vi.mock("../components/SectionBackground", () => ({ SectionBackground: () => null }));
beforeEach(() => { mocks.role = "gm"; mocks.version = 1; mocks.post.mockReset().mockResolvedValue({ id: 9 }); });
afterEach(cleanup);
function show() {
  const shown = render(<MemoryRouter initialEntries={["/maps"]}><Routes><Route path="/maps" element={<MapsListPage />} />
    <Route path="/maps/:id/workspace" element={<p>Основной редактор</p>} /><Route path="/maps/:id" element={<p>Классический экран</p>} />
  </Routes></MemoryRouter>);
  return shown;
}
describe("map entry points", () => {
  it.each([1, 5, 6])("ordinary GM click opens the token editor for version %i", async (version) => {
    mocks.version = version; show(); fireEvent.click(screen.getByRole("link", { name: "Тестовая карта" }));
    expect(await screen.findByText("Основной редактор")).toBeTruthy();
  });
  // Доска Map-List: «Классический редактор» — пункт ⋯ плитки, и только у старой карты.
  function menuItems() {
    let local: ContextMenuItem[] = [];
    const take = (e: Event) => { local = (e as CustomEvent<{ local: ContextMenuItem[] }>).detail.local; };
    window.addEventListener(ENTITY_MENU_EVENT, take);
    fireEvent.click(screen.getByRole("button", { name: "Действия: Тестовая карта" }));
    window.removeEventListener(ENTITY_MENU_EVENT, take);
    return local;
  }
  it("classic editor remains an explicitly named fallback for old maps", async () => {
    show(); const classic = menuItems().find((item) => item.label === "Классический редактор");
    expect(classic).toBeTruthy();
    act(() => classic!.onClick!());
    expect(await screen.findByText("Классический экран")).toBeTruthy();
  });
  it("a map of the new editor has no classic entry", () => {
    mocks.version = 6; show();
    expect(menuItems().map((item) => item.label)).toEqual(["Открыть редактор", "В архив"]);
  });
  it("players keep their viewing route", async () => {
    mocks.role = "player"; show(); fireEvent.click(screen.getByRole("link", { name: "Тестовая карта" }));
    expect(await screen.findByText("Классический экран")).toBeTruthy();
  });
  it("quick draft opens the main editor", async () => {
    show(); fireEvent.click(screen.getByRole("button", { name: "+ Черновик" }));
    expect(await screen.findByText("Основной редактор")).toBeTruthy(); expect(mocks.post).toHaveBeenCalledWith("/maps", expect.objectContaining({ grid: "square", scale: "locality", width: 50, height: 40 }));
  });
  it("create-and-open uses the same main editor", async () => {
    show(); fireEvent.click(screen.getByRole("button", { name: "+ Новая карта" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), { target: { value: "Тестовая новая карта" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать и открыть" }));
    expect(await screen.findByText("Основной редактор")).toBeTruthy();
  });
});
