// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignWorldTab } from "./CampaignWorldTab";
import { UndoDeleteProvider } from "../../hooks/useUndoDelete";
import type { EntityRecord } from "../../entityRecords";
import type { SessionSummary } from "../../types";

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../api/client", async (original) => {
  const actual = await original<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, get: transport.get, post: transport.post } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const sessions = [
  { id: 10, date: "2026-10-17", session_number: 21, title: null, status: "held" },
  { id: 11, date: "2026-10-18", session_number: 22, title: "Под городом", status: "held" },
] as SessionSummary[];
function record(id: number, over: Partial<EntityRecord> = {}): EntityRecord {
  return { id, campaign_id: 7, owner_type: "being", owner_id: 1, owner_name: "Валлен Стерн", aspect: "note", text: `Запись ${id}`,
    status: "established", certainty: "rumor", known_to: "some", known_note: "капитан Стражи", basis: "", function: "", session_id: 10,
    replaces_id: null, replaced_by: null, source: "manual", source_note_id: null, created_at: `2026-10-${String(id).padStart(2, "0")} 12:00:00`, updated_at: "2026-10-17 12:00:00", ...over };
}
const records = [
  record(1), record(2), record(3, { owner_type: "artifact", owner_id: 3, owner_name: "Камень Голорра" }),
  record(4, { owner_type: "campaign", owner_id: 7, aspect: "resources", owner_name: null }),
  record(5, { owner_type: "character", owner_id: 4, owner_name: "Ринна" }),
  record(6, { status: "discarded", text: "Отброшенный слух" }),
  record(7, { replaced_by: 8, text: "Заменённый слух" }),
  record(8, { status: "draft", text: "Дверь открыта", owner_type: "location", owner_id: 2, owner_name: "Старая башня" }),
  record(9, { status: "draft", session_id: 11, owner_type: "campaign", owner_id: 7, aspect: "unsorted", text: "Кому принадлежит ключ?" }),
  record(10, { status: "draft", session_id: 11, owner_type: "character", owner_id: 4, owner_name: "Ринна" }),
  record(11, { status: "draft", session_id: null }),
];
function RouteProbe() { const location = useLocation(); return <output data-testid="route">{location.pathname}{location.search}</output>; }
function mount() {
  transport.get.mockImplementation(async (path: string) => {
    if (path === "/campaigns/7/world") return { setting_id: 8, entities: [], rumors: 5, drafts: 4 };
    if (path === "/campaigns/7/records") return { records };
    if (path === "/settings") return [{ id: 8, name: "Вотердип" }, { id: 9, name: "Другой сеттинг" }];
    return [];
  });
  transport.post.mockImplementation(async (path: string) => path === "/campaigns/7/world" ? { ok: true } : { id: 50, name: "Дом фонарщика" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter><UndoDeleteProvider><CampaignWorldTab campaignId={7} settingId={8} sessions={sessions} /><RouteProbe /></UndoDeleteProvider></MemoryRouter></QueryClientProvider>);
}

describe("записи и создание в мире кампании", () => {
  it.each(["Из сеттинга", "Новая"])("мобильная + открывает действие «%s» с видом из язычка", async (action) => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Артефакты\s*0/ }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить в мир кампании" }));
    fireEvent.click(screen.getByRole("menuitem", { name: action }));
    expect(screen.queryByRole("menu")).toBeNull();
    await screen.findByRole("heading", { name: action === "Новая" ? "Новая сущность" : "Добавить из сеттинга" });
    if (action === "Новая") {
      expect((screen.getByRole("combobox", { name: "Тип" }) as HTMLSelectElement).value).toBe("artifact");
      const setting = screen.getByRole("combobox", { name: "Сеттинг" }) as HTMLSelectElement;
      await waitFor(() => expect(setting.value).toBe("8"));
      expect(setting.disabled).toBe(true);
    }
  });

  it("счёт слухов равен строкам, включая персонажа и кампанию; исключены черновые, отброшенные и заменённые", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Слухи\s*5/ }));
    const region = screen.getByRole("region", { name: "Слухи" });
    await within(region).findByText("5 записей");
    expect([...region.querySelectorAll(".world-record__text")].map((e) => e.textContent)).toEqual(["Запись 5", "Запись 4", "Запись 3", "Запись 2", "Запись 1"]);
    expect(within(region).queryByRole("button")).toBeNull();
    expect(within(region).getByRole("link", { name: "Камень Голорра" }).getAttribute("href")).toBe("/artifacts/3?campaign=7");
    expect(within(region).getAllByText("знает: капитан Стражи")).toHaveLength(5);
    fireEvent.keyDown(within(region).getAllByRole("link", { name: "Открыть профиль: Валлен Стерн" })[0], { key: "Enter" });
    expect(screen.getByTestId("route").textContent).toBe("/beings/1?campaign=7");
  });

  it("группирует четыре черновика по встречам и без сессии, помечает без адреса; разбор только по ссылке в Итоги", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Черновики\s*4/ }));
    const region = screen.getByRole("region", { name: "Черновики" });
    await within(region).findByText("4 черновика");
    expect(region.querySelectorAll(".world-record")).toHaveLength(4);
    expect([...region.querySelectorAll("h4")].map((e) => e.textContent)).toEqual(["Под городом · 18 октября", "Сессия №21 · 17 октября", "Без сессии"]);
    expect(within(region).getByText("без адреса")).toBeDefined();
    const links = within(region).getAllByRole("link", { name: "Разобрать ›" });
    expect(links.map((e) => e.getAttribute("href"))).toEqual(["/sessions/11?tab=%D0%98%D1%82%D0%BE%D0%B3%D0%B8", "/sessions/10?tab=%D0%98%D1%82%D0%BE%D0%B3%D0%B8"]);
    expect(within(region).queryByRole("button")).toBeNull();
    fireEvent.click(links[0]);
    expect(screen.getByTestId("route").textContent).toBe("/sessions/11?tab=%D0%98%D1%82%D0%BE%D0%B3%D0%B8");
  });

  it("ищет записи по тексту и владельцу, счёт колонки сохраняет весь раздел", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Слухи\s*5/ }));
    await screen.findByText("5 записей");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Голорра" } });
    expect(document.querySelectorAll(".world-record")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Слухи\s*5/ })).toBeDefined();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "дверь" } });
    fireEvent.click(screen.getByRole("button", { name: /Черновики\s*4/ }));
    expect(document.querySelectorAll(".world-record")).toHaveLength(1);
    expect(screen.getByText("Дверь открыта")).toBeDefined();
  });

  it.each([
    ["Места 0", "location", "/setting-locations", "/locations"],
    ["Существа 0", "being", "/setting-beings", "/beings"],
    ["Сообщества 0", "community", "/setting-communities", "/communities"],
    ["Артефакты 0", "artifact", "/artifacts", "/artifacts"],
  ])("создаёт из раздела %s в заданном сеттинге, затем задействует и открывает профиль кампании", async (section, kind, path, profile) => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(section.replace(" ", "\\s*")) }));
    fireEvent.click(screen.getByRole("button", { name: /Новая в сеттинге/ }));
    const setting = screen.getByRole("combobox", { name: "Сеттинг" }) as HTMLSelectElement;
    expect(setting.disabled).toBe(true);
    await waitFor(() => expect(setting.value).toBe("8"));
    const type = screen.getByRole("combobox", { name: "Тип" }) as HTMLSelectElement;
    expect(type.value).toBe(kind);
    expect(type.options).toHaveLength(4);
    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), { target: { value: "Дом фонарщика" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() => expect(screen.getByTestId("route").textContent).toBe(`${profile}/50?campaign=7`));
    expect(transport.post).toHaveBeenCalledTimes(2);
    const first = transport.post.mock.calls[0];
    expect(first[0]).toBe(path);
    if (kind === "artifact") {
      expect(first[1].get("setting_id")).toBe("8");
      expect(first[1].get("name")).toBe("Дом фонарщика");
    } else expect(first[1]).toMatchObject({ setting_id: 8, name: "Дом фонарщика" });
    expect(transport.post.mock.calls[1]).toEqual(["/campaigns/7/world", { entity_type: kind, entity_id: 50 }, { broadcast: false }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
