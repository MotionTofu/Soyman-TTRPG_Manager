// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CampaignsListPage } from "./CampaignsListPage";
import { ENTITY_MENU_EVENT } from "../pageMenu";

const campaigns = [
  { id: 1, name: "Эстария", role: "gm", status: "active", system_name: "D&D", setting_name: "Север" },
  { id: 2, name: "Цена вопроса", role: "player", status: "completed", system_name: "City of Mist", setting_name: "Город" },
  { id: 3, name: "Дозоры", role: "gm", status: "paused", system_name: "D&D", setting_name: "Север" },
];
const mocks = vi.hoisted(() => ({ prompt: vi.fn(), put: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}) }));
vi.mock("../data/hooks", () => ({ useAfterWrite: () => vi.fn(), useAction: () => (fn: () => Promise<unknown>) => fn(), write: { put: mocks.put, post: mocks.post }, resourceQuery: () => ({}),
  useResource: (path: string) => ({ loading: false, data: path === "/campaigns" ? campaigns : [] }) }));
// Обрезку в этом файле не проверяем: она общая с мастерским «Обзором» и живёт в
// ImageCropModal. Здесь важно, что пункт меню доводит файл до сервера.
vi.mock("../hooks/useImageCrop", () => ({
  useImageCrop: (_shape: string, onDone: (file: File) => void) => ({
    onSelect: (file: File | null) => { if (file) onDone(file); },
    modal: null,
  }),
}));
vi.mock("../hooks/useConfirm", () => ({ useConfirm: () => [null, vi.fn()], useAlert: () => [null, vi.fn()], usePrompt: () => [null, mocks.prompt] }));
vi.mock("../components/SectionBackground", () => ({ SectionBackground: () => null }));
vi.mock("../utils/fileUrl", () => ({ useAuthenticatedFileUrl: () => null }));
afterEach(cleanup);

function show() {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CampaignsListPage /></MemoryRouter></QueryClientProvider>);
}
describe("список кампаний в Д", () => {
  it("ищет по имени, системе и сеттингу, сбрасывает запрос и сохраняет выбранную роль", () => {
    show();
    const search = screen.getByRole("searchbox", { name: "Поиск по кампаниям" });
    fireEvent.change(search, { target: { value: "  город  " } });
    expect(screen.queryByRole("link", { name: /Эстария/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Цена вопроса" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    fireEvent.click(screen.getByRole("tab", { name: /Я мастер/ }));
    fireEvent.change(search, { target: { value: "D&D" } });
    expect(screen.getByRole("link", { name: /Эстария/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Дозоры" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Цена вопроса" })).toBeNull();
    fireEvent.change(search, { target: { value: "несуществующая" } });
    expect(screen.queryByRole("link", { name: /Эстария/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(screen.getByRole("tab", { name: /Я мастер/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("link", { name: "Цена вопроса" })).toBeNull();
  });
  it("открывает общее меню нужной кампании из плитки, паузы и завершённых без перехода по ссылке", () => {
    const opened = vi.fn();
    window.addEventListener(ENTITY_MENU_EVENT, opened);
    try {
      const shown = show();
      for (const campaign of campaigns) {
        const button = screen.getByRole("button", { name: `Действия: ${campaign.name}` });
        expect(button.closest("a")).toBeNull();
        fireEvent.click(button);
        expect(opened.mock.lastCall?.[0].detail.entity).toEqual({ type: "campaign", id: campaign.id, name: campaign.name });
        expect(shown.container.querySelector(`[data-entity-id="${campaign.id}"]`)).toBeTruthy();
      }
    } finally { window.removeEventListener(ENTITY_MENU_EVENT, opened); }
  });
  it("даёт одинаковую правку через ⋯ и ПКМ, переименовывает и учитывает отмену", async () => {
    const opened = vi.fn();
    window.addEventListener(ENTITY_MENU_EVENT, opened);
    mocks.put.mockClear();
    try {
      const shown = show();
      fireEvent.click(screen.getByRole("button", { name: "Действия: Дозоры" }));
      const rename = opened.mock.lastCall?.[0].detail.local.find((i: { label: string }) => i.label === "Переименовать")!;
      expect(rename.label).toBe("Переименовать");
      mocks.prompt.mockResolvedValueOnce("  Дозоры Севера  ");
      await rename.onClick();
      expect(mocks.put).toHaveBeenCalledWith("/campaigns/3", { name: "Дозоры Севера" });
      const row = shown.container.querySelector('[data-entity-id="3"]')!;
      fireEvent.contextMenu(row);
      expect(opened.mock.lastCall?.[0].detail.local.some((i: { label: string }) => i.label === "Переименовать")).toBe(true);
      mocks.prompt.mockResolvedValueOnce(null);
      await opened.mock.lastCall?.[0].detail.local.find((i: { label: string }) => i.label === "Переименовать")!.onClick();
      expect(mocks.put).toHaveBeenCalledTimes(1);
      opened.mockClear();
      fireEvent.contextMenu(row, { shiftKey: true });
      expect(opened).not.toHaveBeenCalled();
    } finally { window.removeEventListener(ENTITY_MENU_EVENT, opened); }
  });
  it("ставит обложку кампании «Я игрок» из «…» и шлёт файл на сервер", async () => {
    const opened = vi.fn();
    window.addEventListener(ENTITY_MENU_EVENT, opened);
    mocks.post.mockClear();
    try {
      const shown = show();
      fireEvent.click(screen.getByRole("button", { name: "Действия: Цена вопроса" }));
      const item = opened.mock.lastCall?.[0].detail.local.find((i: { label: string }) => i.label === "Сменить обложку")!;
      expect(item).toBeTruthy();
      item.onClick();
      // Обложку в «Обзоре» у такой кампании не поставить — пункт меню и есть вход.
      const input = shown.container.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(["image"], "cover.png", { type: "image/png" })] } });
      await vi.waitFor(() =>
        expect(mocks.post).toHaveBeenCalledWith("/campaigns/2/thumbnail", expect.any(FormData), { timeoutMs: 120_000 })
      );
    } finally {
      window.removeEventListener(ENTITY_MENU_EVENT, opened);
    }
  });
  it("«Список» — таблица с колонками, разделы по статусу; выбор вида помнится", () => {
    localStorage.removeItem("soyman.listView.campaigns");
    show();
    expect(screen.getAllByRole("table")).toHaveLength(2); // на паузе и завершённые — строками и в «Плитках» (Q10)
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getAllByRole("table").map((t) => t.getAttribute("aria-label"))).toEqual(["Активные", "На паузе", "Завершённые"]);
    expect(screen.getAllByRole("columnheader", { name: "Сыграно" })).toHaveLength(3);
    expect(localStorage.getItem("soyman.listView.campaigns")).toBe("rows");
    cleanup();
    show();
    expect(screen.getByRole("button", { name: "Список" }).getAttribute("aria-pressed")).toBe("true");
    localStorage.removeItem("soyman.listView.campaigns");
  });
});
