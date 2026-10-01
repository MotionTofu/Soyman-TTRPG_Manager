// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MapWorkspacePage } from "./MapWorkspacePage";
import type { MapFull } from "../maps/mapTypes";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), raw: vi.fn(), role: "gm" }));
vi.mock("../api/currentUser", () => ({ useCurrentUser: () => ({ user: { role: mocks.role } }) }));
vi.mock("../data/hooks", () => ({ useAfterWrite: () => () => {} }));
vi.mock("../maps/workspace/mapApi", () => ({ mapWorkspaceApi: { read: mocks.read, saveBody: mocks.save }, downloadStoredMapOriginal: mocks.raw, downloadMapJson: vi.fn() }));
vi.mock("../maps/workspace/WorkspaceCanvas", () => ({ WorkspaceCanvas: () => <div>Тестовый холст</div> }));
afterEach(cleanup);
beforeEach(() => { mocks.role = "gm"; mocks.read.mockReset(); mocks.save.mockReset(); localStorage.clear(); });
function record(overrides: Partial<MapFull> = {}): MapFull {
  return { id: 1, name: "Тестовая карта", grid: "square", scale: "locality", width: 12, height: 12,
    cell_lore: "5 м", seed: 1, sea: 55, mountains: 12, forest: 30, thumbnail: null, player_visible: 0,
    parent_map_id: null, created_at: "", updated_at: "", revision: 0,
    cells: '{"v":1,"cells":{},"roads":[]}', ...overrides };
}
function show() { render(<MemoryRouter initialEntries={["/maps/1/workspace"]}><Routes><Route path="/maps/:id/workspace" element={<MapWorkspacePage />} /></Routes></MemoryRouter>); }
describe("MapWorkspacePage boundaries", () => {
  it.each([[' {"v":77,"private":"Test future"} ', "не поддерживает"], ['not-json', "повреждён"]])("keeps unsupported/corrupt bytes out of the canvas and saving: %s", async (cells, text) => {
    mocks.read.mockResolvedValue(record({ cells })); show();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining(text));
    expect(screen.queryByText("Тестовый холст")).toBeNull();
    expect(screen.getByRole("button", { name: "Скачать исходный документ" })).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("published old maps are read-only with an explicit private-copy action", async () => {
    mocks.read.mockResolvedValue(record({ player_visible: 1 })); show();
    await screen.findByText("Тестовый холст");
    expect((screen.getByRole("button", { name: "Выбор" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Создать скрытую копию" })).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("a server without revisions cannot enable the new writer", async () => {
    mocks.read.mockResolvedValue(record({ revision: undefined })); show();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("безопасное сохранение"));
    fireEvent.click(screen.getByTitle("Карта"));
    expect((screen.getByRole("button", { name: "Сохранить сейчас" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("players never request the master document", async () => {
    mocks.role = "player"; show();
    expect(screen.getByText("Новый редактор доступен мастеру.")).toBeTruthy();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
