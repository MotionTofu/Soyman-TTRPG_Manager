// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignWorldTab } from "./CampaignWorldTab";
import { UndoDeleteProvider } from "../../hooks/useUndoDelete";
import type { CampaignWorld, WorldEntity, WorldType } from "../../campaignWorld";
import type { SessionSummary } from "../../types";

const transport = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("../../api/client", async (original) => {
  const actual = await original<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, get: transport.get, put: transport.put, del: transport.del } };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const sessions = [{ id: 10, date: "2026-10-17", session_number: 21, title: null, status: "held" }] as SessionSummary[];
function entity(over: Partial<WorldEntity> = {}): WorldEntity {
  return { entity_type: "being", entity_id: 1, name: "Валлен Стерн", category: "key_figure", manual: false, can_remove: false,
    records: 1, rumors: 0, drafts: 0, state: "dead", image: null,
    summary: { text: "Оставил письмо капитану Стражи.", from_setting: false },
    aspects: [{ key: "state", text: "жив → погиб" }, { key: "knows", text: null }, { key: "note", text: null }, { key: "want", text: null }, { key: "fear", text: null }],
    changed_at: "2026-10-17 10:00:00", last_session: { id: 10, title: null, date: "2026-10-17" }, ...over };
}
function mount(expand?: (e: WorldEntity) => React.ReactNode, types?: readonly WorldType[], historyOnly = false) {
  const world: CampaignWorld = { setting_id: 8, rumors: 4, drafts: 3, entities: [
    entity({ entity_type: "location", entity_id: 2, name: "Старая башня", category: "башня", state: "intact", records: 0, can_remove: true, aspects: [], summary: { text: "Дозорный пост у дороги.", from_setting: true }, changed_at: "2026-10-01 10:00:00", last_session: null }),
    entity(),
    entity({ entity_type: "artifact", entity_id: 3, name: "Камень Голорра", state: "with_party", category: null, summary: { text: "Камень говорит с [[being@12345678|wdh|Лиарой]].", from_setting: false }, changed_at: "2026-10-18 10:00:00" }),
    entity({ entity_id: 4, name: "Черновик о стражнике", state: "alive", records: 0, drafts: 1, aspects: [] }),
  ] };
  if (historyOnly) world.entities.find((e) => e.entity_id === 4)!.drafts = 0;
  transport.get.mockImplementation(async (path: string) => path === "/campaigns/7/world" ? structuredClone(world) : path === "/campaigns/7/sessions" ? sessions : []);
  transport.put.mockImplementation(async (_path: string, body: { state: WorldEntity["state"]; undo_record_id?: number }) => {
    const e = world.entities.find((e) => e.entity_id === 1)!;
    const previous = e.state;
    e.state = body.state;
    return { state: body.state, previous, record_id: 99 };
  });
  transport.del.mockResolvedValue({ ok: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter><UndoDeleteProvider><CampaignWorldTab campaignId={7} settingId={8} sessions={sessions} expand={expand} types={types} /></UndoDeleteProvider></MemoryRouter></QueryClientProvider>);
  return { client };
}

describe("вкладка мира кампании", () => {
  it("сортирует все виды по изменению, ищет текст и фильтрует колонкой; счётчики — записями", async () => {
    mount();
    await screen.findByRole("heading", { name: "Мир кампании" });
    expect([...document.querySelectorAll(".world-row__name")].map((e) => e.textContent)).toEqual(["Камень Голорра", "Валлен Стерн", "Черновик о стражнике", "Старая башня"]);
    expect(screen.getByRole("button", { name: /Слухи/ }).textContent).toContain("4");
    expect(screen.getByRole("button", { name: /Черновики/ }).textContent).toContain("3");
    fireEvent.click(screen.getByRole("button", { name: /Артефакты/ }));
    expect(document.querySelectorAll(".world-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^Все/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск в мире кампании" }), { target: { value: "дозорный" } });
    expect(document.querySelectorAll(".world-row")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Старая башня" }).getAttribute("href")).toBe("/locations/2?campaign=7");
  });

  it("показывает подписи упоминаний в сводке, поиск не ищет служебные uid", async () => {
    mount();
    await screen.findByText("Камень говорит с Лиарой.");
    const search = screen.getByRole("searchbox", { name: "Поиск в мире кампании" });
    fireEvent.change(search, { target: { value: "Лиарой" } });
    expect(document.querySelectorAll(".world-row")).toHaveLength(1);
    fireEvent.change(search, { target: { value: "12345678" } });
    expect(screen.getByText("Ничего не подходит.")).toBeDefined();
  });

  it("показывает переход состояния, три графы и ещё N; у основы нет плашки", async () => {
    mount();
    await screen.findByRole("link", { name: "Валлен Стерн" });
    expect(screen.getAllByText("состояние (жив → погиб)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ещё 2").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Сессия №21/ }).length).toBeGreaterThan(0);
    const tower = screen.getByRole("link", { name: "Старая башня" }).closest("li")!;
    expect(within(tower).queryByRole("button", { name: /Состояние/ })).toBeNull();
    expect(within(tower).getByText(/из сеттинга/)).toBeDefined();
    expect(within(tower).getByRole("button", { name: "+ Запись" })).toBeDefined();
  });

  it("меняет состояние и отменяет по возвращённому id; повторно читает мир", async () => {
    mount();
    const button = await screen.findByRole("button", { name: "Состояние Валлен Стерн: погиб. Изменить" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "пропал" }));
    await screen.findByText("Валлен Стерн: пропал");
    expect(transport.put).toHaveBeenCalledWith("/campaigns/7/world/being/1/state", { state: "missing" }, { broadcast: false });
    await screen.findByRole("button", { name: "Состояние Валлен Стерн: пропал. Изменить" });
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await waitFor(() => expect(transport.put).toHaveBeenLastCalledWith("/campaigns/7/world/being/1/state", { state: "dead", undo_record_id: 99 }, { broadcast: false }));
    await screen.findByRole("button", { name: "Состояние Валлен Стерн: погиб. Изменить" });
  });

  it("ПКМ открывает состояние по умолчанию; убрать можно только без действующих и черновых записей", async () => {
    mount();
    const tower = (await screen.findByRole("link", { name: "Старая башня" })).closest("li")!;
    fireEvent.contextMenu(tower, { clientX: 20, clientY: 20 });
    expect(screen.getByRole("menuitem", { name: "✓ цело" })).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(tower).getByRole("button", { name: "Действия: Старая башня" }));
    expect(screen.getByRole("menuitem", { name: "Убрать из кампании" })).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Действия: Черновик о стражнике" }));
    expect(screen.queryByRole("menuitem", { name: "Убрать из кампании" })).toBeNull();
  });

  it("скрывает удаление, если API сохраняет историю, даже при нуле действующих записей", async () => {
    mount(undefined, undefined, true);
    const guard = (await screen.findByRole("link", { name: "Черновик о стражнике" })).closest("li")!;
    fireEvent.click(within(guard).getByRole("button", { name: "Действия: Черновик о стражнике" }));
    expect(screen.queryByRole("menuitem", { name: "Убрать из кампании" })).toBeNull();
  });

  it("сохраняет раскрытие записей тетради через types и expand", async () => {
    const expand = vi.fn((e: WorldEntity) => <div>Записи: {e.name}</div>);
    mount(expand, ["location"]);
    await screen.findByRole("link", { name: "Старая башня" });
    expect(screen.queryByRole("heading", { name: "Мир кампании" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Виды мира кампании" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Добавить в мир|Добавить из сеттинга/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Валлен Стерн" })).toBeNull();
    expect(document.querySelectorAll(".world-row")).toHaveLength(1);
    expect(expand).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск в мире кампании" }), { target: { value: "дозорный" } });
    const row = screen.getByRole("link", { name: "Старая башня" }).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Записи" }));
    expect(within(row).getByRole("button", { name: "Свернуть" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Записи: Старая башня")).toBeDefined();
    fireEvent.click(within(row).getByRole("button", { name: "Свернуть" }));
    expect(screen.queryByText("Записи: Старая башня")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск в мире кампании" }), { target: { value: "валлен" } });
    expect(screen.getByText("Ничего не подходит.")).toBeDefined();
  });

  it("компактные стороны показывают новые строки и раскрывают только одну карточку", async () => {
    mount((e) => <div>Записи: {e.name}</div>, ["being", "community"]);
    const vallen = (await screen.findByRole("link", { name: "Валлен Стерн" })).closest("li")!;
    expect(screen.queryByRole("link", { name: "Старая башня" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Камень Голорра" })).toBeNull();
    expect(within(vallen).getByRole("button", { name: /Состояние Валлен/ })).toBeDefined();
    fireEvent.click(within(vallen).getByRole("button", { name: "Записи" }));
    const guard = screen.getByRole("link", { name: "Черновик о стражнике" }).closest("li")!;
    fireEvent.click(within(guard).getByRole("button", { name: "Записи" }));
    expect(screen.queryByText("Записи: Валлен Стерн")).toBeNull();
    expect(screen.getByText("Записи: Черновик о стражнике")).toBeDefined();
  });

  it("мобильная + закрывается Escape и возвращает фокус", async () => {
    mount();
    const add = await screen.findByRole("button", { name: "Добавить в мир кампании" });
    fireEvent.click(add);
    expect(screen.getByRole("menu", { name: "Добавить в мир кампании" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Из сеттинга" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Новая" })).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(add);
    expect(add.getAttribute("aria-expanded")).toBe("false");
  });
});
