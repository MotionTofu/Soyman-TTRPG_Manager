// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import type { CutsceneOriginal } from "@shared/cutscenes/types";
const mocks = vi.hoisted(() => ({ role: "gm", mobile: false, error: null as string | null, reload: vi.fn(), original: null as CutsceneOriginal | null }));
vi.mock("../api/currentUser", () => ({ useCurrentUser: () => ({ loading: false, user: { id: 1, role: mocks.role } }), getCachedUser: () => null }));
vi.mock("../hooks/useIsMobile", () => ({ useIsMobile: () => mocks.mobile }));
vi.mock("../components/cutscenes/CutsceneCover", () => ({ CutsceneCover: () => <div>Миниатюра</div> }));
vi.mock("../data/hooks", async importOriginal => {
  const actual = await importOriginal<typeof import("../data/hooks")>();
  return { ...actual, useResource: vi.fn((path: string | null) => {
    const original = mocks.original!;
    return { loading: false, error: path?.startsWith("/cutscenes?") ? mocks.error : null, reload: mocks.reload,
      data: path === "/campaigns" ? [] : path?.startsWith("/cutscenes?") ? [{ id: original.id, name: original.document.name,
        description: original.document.description, savedVersion: original.savedVersion, createdAt: original.createdAt, updatedAt: original.updatedAt, archivedAt: null, stepCount: 5, campaigns: ["Берез", "Вотердип"] }]
        : path?.startsWith("/cutscenes/") ? original : undefined };
  }) };
});
vi.mock("../data/cutscenes", async importOriginal => ({ ...await importOriginal<typeof import("../data/cutscenes")>(),
  cutscenes: { create: vi.fn(), duplicate: vi.fn(), updateMetadata: vi.fn(), saveDraft: vi.fn() } }));
vi.mock("../components/cutscenes/CutsceneLaunchActions", () => ({ CutsceneLaunchActions: () => <button>Показать игрокам</button> }));
vi.mock("../components/cutscenes/CutsceneWorkshopEditor", () => ({ CutsceneWorkshopEditor: () => <div>Мастерская</div> }));
import { cutscenes } from "../data/cutscenes";
import { useResource } from "../data/hooks";
import { queryClient } from "../data/queryClient";
import { dismissNotice, getSaveNotices } from "../data/notices";
import { CutscenesPage } from "./CutscenesPage";
import { CutsceneWorkshopPage } from "./CutsceneWorkshopPage";

function original(): CutsceneOriginal {
  return { id: 11, savedVersion: "v1", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", archivedAt: null,
    document: { ...createCutsceneDocument("Порт"), description: "Мокрые камни", steps: [{ ...createCutsceneStep("intro"), text: { action: "replace", text: "**Ворота**" } }] } };
}
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname + location.search}</output>; }
function renderPage(path = "/mastering/cutscenes") {
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><Location /><Routes>
    <Route path="/mastering/cutscenes" element={<CutscenesPage />} /><Route path="/mastering/cutscenes/:id" element={<CutsceneWorkshopPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); queryClient.clear(); mocks.role = "gm"; mocks.mobile = false; mocks.error = null; mocks.original = original();
  vi.mocked(cutscenes.create).mockResolvedValue({ ...original(), id: 12 });
  vi.mocked(cutscenes.duplicate).mockResolvedValue({ ...original(), id: 12 });
  vi.mocked(cutscenes.updateMetadata).mockImplementation(async (_id, patch) => ({ ...mocks.original!, document: { ...mocks.original!.document, ...patch } }));
});
afterEach(() => { cleanup(); queryClient.clear(); getSaveNotices().forEach(notice => dismissNotice(notice.id)); });
describe("каталог катсцен", () => {
  it("восстанавливает условия из URL и отправляет сортировку/поиск в ресурс каталога", () => {
    renderPage("/mastering/cutscenes?search=Порт&sort=name&order=desc&archive=all");
    expect((screen.getByRole("textbox", { name: "Поиск катсцен" }) as HTMLInputElement).value).toBe("Порт");
    fireEvent.change(screen.getByRole("combobox", { name: "Сортировка" }), { target: { value: "updated:asc" } });
    expect(screen.getByTestId("location").textContent).toContain("order=asc");
    expect(vi.mocked(useResource).mock.calls.some(([path]) => path?.startsWith("/cutscenes?") && path.includes("sort=updated") && path.includes("search="))).toBe(true);
  });
  it("карточка называет число шагов и кампании подборок, шапка — без «Библиотеки»", () => {
    renderPage("/mastering/cutscenes");
    expect(screen.getByText("5 шагов · Берез, Вотердип")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Библиотека" })).toBeNull();
  });
  it("player-role не монтирует каталог и не читает закрытые документы", () => {
    mocks.role = "player"; renderPage(); expect(screen.getByText("Только для Мастера")).toBeTruthy(); expect(useResource).not.toHaveBeenCalled();
  });
  it("не теряет поиск при следующем изменении архива в том же пакете событий", () => {
    renderPage("/mastering/cutscenes?search=Старое");
    act(() => {
      fireEvent.change(screen.getByRole("textbox", { name: "Поиск катсцен" }), { target: { value: "Новое" } });
      fireEvent.change(screen.getByRole("combobox", { name: "Архив" }), { target: { value: "archived" } });
    });
    expect((screen.getByRole("textbox", { name: "Поиск катсцен" }) as HTMLInputElement).value).toBe("Новое");
    expect(screen.getByTestId("location").textContent).toContain("archive=archived");
  });
  it("телефон показывает каталог без создания и дублирования", () => {
    mocks.mobile = true; renderPage(); expect(screen.getByRole("heading", { name: "Порт" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Новая катсцена" })).toBeNull(); expect(screen.queryByRole("button", { name: /Дублировать/ })).toBeNull();
  });
  it("создание сохраняет название/описание и открывает общий оригинал", async () => {
    renderPage(); fireEvent.click(screen.getByRole("button", { name: "Новая катсцена" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), { target: { value: "Новая" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Описание" }), { target: { value: "Пролог" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/mastering/cutscenes/12"));
    expect(cutscenes.create).toHaveBeenCalledWith("Новая", "Пролог");
  });
  it("дублирование открывает созданную независимую запись", async () => {
    renderPage(); fireEvent.click(screen.getByText("⋯")); fireEvent.click(screen.getByRole("button", { name: "Дублировать катсцену «Порт»" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/mastering/cutscenes/12")); expect(cutscenes.duplicate).toHaveBeenCalledWith(11);
  });
  it("ошибка каталога использует принятую карточку с повтором", () => {
    mocks.error = "Нет связи"; renderPage(); expect(screen.getByText(/Не удалось загрузить катсцены/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" })); expect(mocks.reload).toHaveBeenCalledTimes(1);
  });
  it("на телефоне открывает форматированный текст, не предлагая мастерскую", () => {
    mocks.mobile = true; renderPage("/mastering/cutscenes/11"); expect(screen.getByText("Ворота").closest("strong")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Название" })).toBeNull(); expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
  });
});
