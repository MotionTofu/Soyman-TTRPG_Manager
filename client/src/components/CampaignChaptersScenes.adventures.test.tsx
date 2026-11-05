// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignChaptersScenes } from "./CampaignChaptersScenes";
import type { CampaignAdventureTree, StoryArc } from "../types";

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api/client", async (original) => {
  const actual = await original<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, get: transport.get, post: transport.post } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Текущий адрес">{location.pathname}{location.search}</output>;
}

async function mount(settingId: number | null = 8) {
  const tree: CampaignAdventureTree[] = [];
  const ready = { id: 41, name: "Тест: готовое приключение", scene_count: 0, chapter_count: 0 } as StoryArc;
  transport.get.mockImplementation(async (path: string) => {
    if (path.includes("campaign-tree")) return structuredClone(tree);
    if (path.includes("campaign-adventures/available")) return tree.some((arc) => arc.id === ready.id) ? [] : [ready];
    if (path.endsWith("/reveals")) return { adventures: [] };
    if (path.includes("/clues")) return { nodes: [] };
    return [];
  });
  transport.post.mockImplementation(async (path: string, body: Record<string, unknown>) => {
    const arc = (path === "/story/arcs" ? { ...body, id: 42 } : ready) as StoryArc;
    tree.push({ ...arc, chapters: [], scenes: [] });
    return arc;
  });
  const onPick = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/campaigns/7?tab=Сюжет"]}>
        <CampaignChaptersScenes campaignId={7} settingId={settingId} onPickAdventure={onPick} />
        <CurrentLocation />
      </MemoryRouter>
    </QueryClientProvider>
  );
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return { onPick };
}

describe("приключения из вкладки «Сюжет»", () => {
  it("создаёт приключение сеттинга, сразу обновляет сюжет и передаёт все поля формы", async () => {
    const { onPick } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Создать приключение" }));
    const form = within(screen.getByRole("dialog", { name: "Новое приключение" }));
    expect(form.getByText(/будет создано в сеттинге и добавлено/)).toBeDefined();
    fireEvent.change(form.getByRole("textbox", { name: "Название" }), { target: { value: "Тест: новое приключение" } });
    fireEvent.click(form.getByRole("button", { name: "Далее" }));
    for (const [name, value] of [["Уровень персонажей", "3–5"], ["Число игроков", "4"], ["Длительность", "2 встречи"], ["Источник", "Тест"], ["Теги", "тайна"]]) {
      fireEvent.change(form.getByRole("textbox", { name }), { target: { value } });
    }
    fireEvent.click(form.getByRole("button", { name: "Далее" }));
    fireEvent.change(form.getByRole("textbox", { name: "Логлайн" }), { target: { value: "Тестовый логлайн" } });
    fireEvent.click(form.getByRole("button", { name: "Далее" }));
    fireEvent.change(form.getByRole("textbox", { name: "Завязка" }), { target: { value: "Тестовая завязка" } });
    fireEvent.click(form.getByRole("button", { name: "Создать и вернуться" }));
    await screen.findByRole("button", { name: /Тест: новое приключение/ });
    expect(transport.post).toHaveBeenCalledExactlyOnceWith("/story/arcs", {
      setting_id: 8, attach_campaign_id: 7, name: "Тест: новое приключение", description: "Тестовый логлайн",
      hook: "Тестовая завязка", recommended_level: "3–5", player_count: "4", duration: "2 встречи", source: "Тест", tags: "тайна",
    }, { broadcast: false });
    expect(onPick).toHaveBeenCalledWith(42);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("добавляет существующее приключение и перечитывает список доступных", async () => {
    const { onPick } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Добавить из сеттинга" }));
    const form = within(screen.getByRole("dialog", { name: "Добавить из сеттинга" }));
    await form.findByText("Тест: готовое приключение");
    fireEvent.click(form.getByRole("button", { name: "Добавить" }));
    await screen.findByRole("button", { name: /Тест: готовое приключение/ });
    expect(transport.post).toHaveBeenCalledExactlyOnceWith("/story/campaign-adventures", { campaign_id: 7, arc_id: 41 }, { broadcast: false });
    expect(onPick).toHaveBeenCalledWith(41);
    fireEvent.click(screen.getByRole("button", { name: "Добавить из сеттинга" }));
    await screen.findByText(/Нет доступных приключений/);
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Добавить" })).toBeNull();
  });

  it("открывает созданное приключение в контексте текущей кампании", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Создать приключение" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), { target: { value: "Тест: переход" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать и перейти в приключение" }));
    await waitFor(() => expect(screen.getByLabelText("Текущий адрес").textContent).toBe("/adventures/42?campaign=7"));
  });

  it("сохраняет набранное и остаётся в форме при отказе сервера", async () => {
    await mount();
    transport.post.mockRejectedValueOnce(new Error("Тест: сервер недоступен"));
    fireEvent.click(screen.getByRole("button", { name: "Создать приключение" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), { target: { value: "Тест: черновик" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать и вернуться" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Тест: сервер недоступен");
    expect((screen.getByRole("textbox", { name: "Название" }) as HTMLInputElement).value).toBe("Тест: черновик");
    expect(screen.getByRole("dialog", { name: "Новое приключение" })).toBeDefined();
  });

  it("без сеттинга предлагает выбрать его и не позволяет создавать приключение", async () => {
    await mount(null);
    expect(screen.getByText(/выберите сеттинг кампании/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Создать приключение" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Добавить из сеттинга" })).toBeNull();
  });
});
