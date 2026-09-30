// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MapsListPage } from "./MapsListPage";
const mocks = vi.hoisted(() => ({ role: "gm", version: 1, post: vi.fn() }));
vi.mock("../api/currentUser", () => ({ useCurrentUser: () => ({ user: { role: mocks.role } }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...await importOriginal<typeof import("@tanstack/react-query")>(), useQueries: () => [] }));
vi.mock("../data/hooks", () => ({ useAction: () => vi.fn(), useAfterWrite: () => vi.fn(), resourceQuery: () => ({}), write: { post: mocks.post },
  useResource: () => ({ loading: false, data: [{ id: 7, name: "Тестовая карта", grid: "hex", scale: "continent", width: 40, height: 30, updated_at: "2026-09-30", document_version: mocks.version, player_visible: 0 }] }) }));
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
    mocks.version = version; const shown = show(); fireEvent.click(shown.container.querySelector(".campaign-tile-cover")!);
    expect(await screen.findByText("Основной редактор")).toBeTruthy();
  });
  it("classic editor remains an explicitly named fallback for old maps", async () => {
    show(); fireEvent.click(screen.getByRole("link", { name: "Классический редактор" }));
    expect(await screen.findByText("Классический экран")).toBeTruthy();
  });
  it("players keep their viewing route", async () => {
    mocks.role = "player"; const shown = show(); fireEvent.click(shown.container.querySelector(".campaign-tile-cover")!);
    expect(await screen.findByText("Классический экран")).toBeTruthy();
  });
  it("quick draft opens the main editor", async () => {
    show(); fireEvent.click(screen.getByRole("button", { name: "+ Черновик" }));
    expect(await screen.findByText("Основной редактор")).toBeTruthy(); expect(mocks.post).toHaveBeenCalledWith("/maps", expect.objectContaining({ grid: "hex" }));
  });
  it("create-and-open uses the same main editor", async () => {
    show(); fireEvent.click(screen.getByRole("button", { name: "+ Новая карта" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), { target: { value: "Тестовая новая карта" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать и открыть" }));
    expect(await screen.findByText("Основной редактор")).toBeTruthy();
  });
});
