// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SystemDetailPage } from "./SystemDetailPage";

const mocks = vi.hoisted(() => ({ del: vi.fn().mockResolvedValue({}) }));
vi.mock("../data/hooks", () => ({
  useAction: () => (fn: () => Promise<unknown>) => fn(),
  write: { del: mocks.del },
  useResource: (path: string) => ({ data: path === "/systems/5" ? { id: 5, name: "Тестовая система", description: "", code: "test" }
    : path === "/systems/5/sections" ? [{ id: 8, name: "Справочник", kind: "wiki" }] : [] }),
}));
vi.mock("../components/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("../components/SectionBackground", () => ({ SectionBackground: () => null }));
vi.mock("../components/CompendiumSection", () => ({ CompendiumSection: () => <p>Содержимое справочника</p> }));
vi.mock("../components/MonsterSection", () => ({ MonsterSection: () => null }));
vi.mock("../components/VehicleSection", () => ({ VehicleSection: () => null }));
vi.mock("../components/MechanicsSection", () => ({ MechanicsSection: () => null }));
vi.mock("../hooks/useImageCrop", () => ({ useImageCrop: () => ({ onSelect: vi.fn(), modal: null }) }));

afterEach(() => { cleanup(); mocks.del.mockClear(); });

describe("действия системы вне Обзора", () => {
  it("показывает подтверждение архивации из раздела и выполняет действие только после согласия", async () => {
    render(<MemoryRouter initialEntries={["/systems/5?section=8"]}><Routes>
      <Route path="/systems/:id" element={<SystemDetailPage />} />
      <Route path="/systems" element={<p>Список систем после архивации</p>} />
    </Routes></MemoryRouter>);
    const openArchive = () => {
      fireEvent.click(screen.getByRole("button", { name: "Ещё действия" }));
      fireEvent.click(screen.getByRole("button", { name: "Архивировать" }));
    };
    openArchive();
    expect(screen.getByRole("dialog", { name: "Архивировать систему?" })).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("Тестовая система");
    expect(mocks.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(mocks.del).not.toHaveBeenCalled();
    openArchive();
    fireEvent.click(screen.getByRole("button", { name: "Архивировать" }));
    expect(await screen.findByText("Список систем после архивации")).toBeTruthy();
    expect(mocks.del).toHaveBeenCalledWith("/systems/5");
  });
});
