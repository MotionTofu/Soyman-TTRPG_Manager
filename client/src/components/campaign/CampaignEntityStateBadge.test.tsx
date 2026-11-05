// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAMPAIGN_ENTITY_STATES } from "@shared/campaignWorld";
import { CampaignEntityStateBadge } from "./CampaignEntityStateBadge";
import { useCampaignEntityStateMenu } from "./useCampaignEntityStateMenu";
import { CampaignWorldTab } from "./CampaignWorldTab";
import { ArtifactDetailPage } from "../../pages/ArtifactDetailPage";
import { UndoDeleteProvider } from "../../hooks/useUndoDelete";
import { campaignPaths } from "../../data/campaigns";
import { setCachedUser } from "../../api/currentUser";
import type { WorldEntity, WorldType } from "../../campaignWorld";
import type { EntityRecord } from "../../entityRecords";
import type { ReactNode } from "react";

const transport = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("../../api/client", async (original) => {
  const actual = await original<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, get: transport.get, put: transport.put } };
});
beforeEach(() => {
  setCachedUser({ id: 1, username: "gm", role: "gm", playerId: null, isAdmin: true });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); setCachedUser(null); });
const sessions = [{ id: 10, date: "2026-10-23", session_number: 1, title: null, status: "held" as const }];
function entity(kind: WorldType): WorldEntity {
  return { entity_type: kind, entity_id: 50, name: "Камень", category: null, manual: true, can_remove: true, records: 0, rumors: 0, drafts: 0,
    state: CAMPAIGN_ENTITY_STATES[kind][0].key, image: null, summary: { text: "Основа", from_setting: true }, aspects: [],
    changed_at: "2026-10-23 12:00:00", last_session: null };
}
function wrap(children: ReactNode, initial = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}><UndoDeleteProvider>{children}</UndoDeleteProvider></MemoryRouter></QueryClientProvider>);
}

function StateHeader({ kind }: { kind: WorldType }) {
  const state = useCampaignEntityStateMenu(7, kind, 50);
  return <div data-testid="state-header" onContextMenu={state.onContextMenu}>{state.badge}{state.menu}</div>;
}

describe("состояние в шапке профиля", () => {
  it.each(["being", "location", "community", "artifact"] as const)("%s: шапка и строка обновляют друг друга и отмену через общий ресурс", async (kind) => {
    const e = entity(kind);
    const choices = CAMPAIGN_ENTITY_STATES[kind];
    transport.get.mockImplementation(async () => ({ setting_id: 8, entities: [structuredClone(e)], rumors: 0, drafts: 0 }));
    transport.put.mockImplementation(async (_path: string, body: { state: WorldEntity["state"] }) => {
      const previous = e.state; e.state = body.state;
      return { state: e.state, previous, record_id: 77 };
    });
    wrap(<><StateHeader kind={kind} /><CampaignWorldTab campaignId={7} settingId={8} sessions={[]} /></>);
    const label = (index: number) => `Состояние Камень: ${choices[index].label}. Изменить`;
    await screen.findByRole("heading", { name: "Мир кампании" });
    await waitFor(() => expect(transport.get).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: label(0) })).toBeNull();
    fireEvent.contextMenu(screen.getByTestId("state-header"), { clientX: 20, clientY: 20 });
    await screen.findByRole("menuitem", { name: `✓ ${choices[0].label}` });
    fireEvent.click(screen.getByRole("menuitem", { name: choices[1].label }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: label(1) })).toHaveLength(2));
    // Теперь меняем из строки мира, шапка остаётся смонтированной.
    fireEvent.click(screen.getAllByRole("button", { name: label(1) })[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: choices[2].label }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: label(2) })).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: label(1) })).toHaveLength(2));
    expect(transport.put).toHaveBeenLastCalledWith(`/campaigns/7/world/${kind}/50/state`, { state: choices[1].key, undo_record_id: 77 }, { broadcast: false });
  });

  it("игрок не видит плашку и не запрашивает мир кампании", () => {
    setCachedUser({ id: 2, username: "player", role: "player", playerId: 9, isAdmin: false });
    wrap(<CampaignEntityStateBadge campaignId={7} entityType="artifact" entityId={50} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(transport.get).not.toHaveBeenCalled();
  });
});

describe("профиль артефакта в кампании", () => {
  function mount() {
    const e = entity("artifact"); e.state = "with_party";
    const base = { id: 50, setting_id: 8, name: "Камень", description: "Описание основы", power: "Свойства основы", history: "История основы", notes: "Заметки основы", secret: "Тайна основы",
      aliases: [], tags: ["реликвия"], item_class: null, item_type: null, rarity: null, owner: "", chapters: [], important_dates: [],
      campaigns: [{ id: 7, name: "Вотердип", records: 1, drafts: 0, rumors: 0, last_session: { id: 10, date: "2026-10-23", title: null } }] };
    const record = { id: 1, campaign_id: 7, owner_type: "artifact", owner_id: 50, owner_name: "Камень", aspect: "holder", text: "У героев", status: "established", certainty: "known", known_to: "gm", known_note: "", session_id: 10, replaced_by: null, replaces_id: null, basis: "", source: "manual", source_note_id: null, function: "", created_at: "2026-10-23", updated_at: "2026-10-23" } satisfies EntityRecord;
    transport.get.mockImplementation(async (path: string) => {
      if (path === "/artifacts/50") return base;
      if (path === "/settings/8") return { name: "Сеттинг" };
      if (path.includes("relations")) return { incoming: [], outgoing: [] };
      if (path === "/campaigns/7/world") return { setting_id: 8, entities: [e], rumors: 0, drafts: 0 };
      if (path.startsWith("/campaigns/7/records")) return { records: [record] };
      if (path === campaignPaths.sessions(7)) return sessions;
      return [];
    });
    wrap(<Routes><Route path="/artifacts/:id" element={<ArtifactDetailPage />} /></Routes>, "/artifacts/50?campaign=7");
  }

  it("показывает крошки и графы кампании с пустыми полями, основа и портрет только читаются", async () => {
    mount();
    await screen.findByRole("heading", { name: /Сейчас в кампании/ });
    expect(screen.getByRole("link", { name: "Мир кампании" }).getAttribute("href")).toContain("/campaigns/7?tab=");
    expect(await screen.findByText("У героев")).toBeDefined();
    expect(screen.getByText(/Не заполнено:/).textContent).toContain("что открылось о свойствах");
    expect(screen.queryByPlaceholderText("+ тег")).toBeNull();
      expect(screen.queryByRole("button", { name: "+ ТЕГ" })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "+ род предмета" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Ход в кампании/ })).toBeNull();
    expect(screen.getByText("Описание основы")).toBeDefined();
    expect(screen.getByText("Свойства основы")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Основа сеттинга" }));
    await screen.findByRole("heading", { name: /Задействована в кампаниях/ });
      fireEvent.click(screen.getByRole("button", { name: "+ ТЕГ" }));
      expect(screen.getByPlaceholderText("+ тег")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Состояние Камень:/ })).toBeNull();
  });

  it("Хроника берёт записи по встречам кампании вместо календарных дат основы", async () => {
    mount();
    await screen.findByRole("heading", { name: /Сейчас в кампании/ });
    fireEvent.click(screen.getByRole("tab", { name: "Хроника" }));
    await screen.findByRole("heading", { name: /Что изменилось в «Вотердип»/ });
    expect(await screen.findByText("Сессия №1 · 23 октября")).toBeDefined();
    expect(await screen.findByText("У героев")).toBeDefined();
    expect(screen.queryByPlaceholderText("Дата (напр. День находки)")).toBeNull();
  });
});
