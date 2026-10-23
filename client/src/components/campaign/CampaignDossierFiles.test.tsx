// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDndCharacter } from "@shared/dnd/normalize";
import { resourceQuery } from "../../data/hooks";
import { statblockListPath } from "../../data/statblocks";
import type { Character, CompendiumEntry, RosterPlayer } from "../../types";
import { CampaignDossierFiles, useCharacterSheets } from "./CampaignDossierFiles";

const live = vi.hoisted(() => ({ entries: new Map<number, CompendiumEntry>() }));
vi.mock("../dnd/useCompendiumEntries", () => ({ useCompendiumEntries: () => (id: number) => live.entries.get(id) }));
afterEach(() => { cleanup(); live.entries.clear(); });
const roster = [
  { id: 2, name: "Ксюша", roster_status: "left" },
  { id: 1, name: "Колян", roster_status: "active", last_session_date: "2026-10-17", last_session_attended: 1 },
] as RosterPlayer[];
const characters = [
  { id: 10, player_id: 1, character_name: "Ларри", status: "reserve" },
  { id: 11, player_id: 1, character_name: "Ролдан", status: "active", thumbnail_image_url: "javascript:alert(1)" },
  { id: 13, player_id: 1, character_name: "Мира", status: "dead" },
  { id: 12, player_id: 2, character_name: "Арья" },
] as Character[];
const key = (id: number) => resourceQuery(statblockListPath("character", id)).queryKey;

type Props = Parameters<typeof CampaignDossierFiles>[0];
function Harness(props: Omit<Props, "sheets">) {
  return <CampaignDossierFiles {...props} sheets={useCharacterSheets(props.characters)} />;
}
function mount(over: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  characters.forEach((c) => client.setQueryData(key(c.id), []));
  const props = { roster, characters, debts: [], currency: "₽", hideFinance: false, addingFor: null, drafts: {},
    onDraft: vi.fn(), onStartAdding: vi.fn(), onCancelAdding: vi.fn(), onAddCharacter: vi.fn(), onPeek: vi.fn(),
    onStatus: vi.fn(), onDelete: vi.fn(), onSettle: vi.fn(), onToggleLeft: vi.fn(), onRemovePlayer: vi.fn(), ...over };
  const ui = (next = props) => <QueryClientProvider client={client}><MemoryRouter><div className="campaign-dossier"><Harness {...next} /></div></MemoryRouter></QueryClientProvider>;
  const rendered = render(ui());
  return { props, client, rendered, ui };
}

describe("личные дела состава кампании", () => {
  it("игрок — хозяин дела: живые полными блоками по статусу, погибшие — в «Памяти», покинувшие в конце", () => {
    const { rendered } = mount();
    const files = rendered.container.querySelectorAll(".dossier-file");
    expect(files).toHaveLength(2);
    expect(files[0].querySelector(".dossier-file__player")?.textContent).toBe("Колян");
    expect(files[1].classList.contains("is-left")).toBe(true);
    expect(screen.getByText("Покинули кампанию")).toBeTruthy();
    // Активный — первым, запасной — за ним; погибшая — не блоком, а строкой.
    expect([...files[0].querySelectorAll(".dossier-character .dossier-photo__signature")].map((e) => e.textContent)).toEqual(["Ролдан", "Ларри"]);
    expect(files[0].querySelector(".dossier-memory")?.textContent).toContain("† Мира");
    expect(files[0].querySelector(".dossier-file__last")?.textContent).toContain("присутствовал");
    expect(screen.getByRole("link", { name: "Лист персонажа Ролдан" }).querySelector("img")).toBeNull();
    expect(screen.getAllByText(/Лист не заполнен/)).toHaveLength(3);
  });

  it("статус меняется из меню плашки и по ПКМ; удаление и быстрый просмотр — туда же", () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Статус Ролдан: Активный" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Погиб/ }));
    expect(props.onStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), "dead");
    fireEvent.contextMenu(screen.getByRole("link", { name: "Лист персонажа Ларри" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить персонажа…" }));
    expect(props.onDelete).toHaveBeenCalledWith(10, "Ларри");
    fireEvent.click(screen.getByRole("button", { name: "Быстрый просмотр Ролдан" }));
    expect(props.onPeek).toHaveBeenCalledWith(11);
  });

  it("одно меню дела про игрока, клавиатура, закрытие по Escape и щелчку мимо", () => {
    const { props } = mount();
    const trigger = screen.getByRole("button", { name: "Действия с делом Колян" });
    fireEvent.click(trigger);
    const first = screen.getByRole("menuitem", { name: "Открыть игрока" });
    expect(document.activeElement).toBe(first);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Убрать из состава" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Действия с делом Ксюша" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Вернуть в состав" }));
    expect(props.onToggleLeft).toHaveBeenCalledWith(2, "left");
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(props.onRemovePlayer).not.toHaveBeenCalled();
  });

  it("КЗ считается с живыми эффектами снаряжения и обновляется вслед за листом", async () => {
    const { client } = mount();
    const sheet = { ...emptyDndCharacter(), raceName: "Человек", armorClass: "99", hitPointMax: "43", speed: "30",
      classes: [{ classId: null, className: "Друид", subclassId: null, subclassName: "", level: 1, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "" }],
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      equipmentSections: [{ name: "", items: [{ id: "armor", name: "Доспех", qty: "1", weight: "", notes: "", equipped: true, entryId: 100 }] }] };
    live.entries.set(100, { data: { effects: [{ id: "armor", type: "defense", when: "always", acBase: { base: 14, abilities: ["dex"] } }] } } as unknown as CompendiumEntry);
    await act(async () => client.setQueryData(key(10), [{ format: "dnd_character", content: JSON.stringify(sheet) }]));
    await waitFor(() => expect(screen.getByText("Человек · Друид 1")).toBeTruthy());
    const dl = screen.getByLabelText("Характеристики Ларри");
    expect([...dl.querySelectorAll("dd")].map((e) => e.textContent)).toEqual(["16", "43/43", "30"]);
    sheet.abilities.dex = 16;
    await act(async () => client.setQueryData(key(10), [{ format: "dnd_character", content: JSON.stringify(sheet) }]));
    await waitFor(() => expect(screen.getByLabelText("Характеристики Ларри").querySelectorAll("dd")[0].textContent).toBe("17"));
    await act(async () => client.setQueryData(key(10), [{ format: "dnd_character", content: "{broken" }]));
    await waitFor(() => expect(screen.queryByLabelText("Характеристики Ларри")).toBeNull());
  });

  it("долг — плашкой с «Оплатил», скрыт при скрытых финансах; добавление персонажа", () => {
    const debt = { player_id: 1, player_name: "Колян", owed: 1000, sessions: 1 };
    const { props, rendered, ui } = mount({ addingFor: 1, drafts: { 1: "Новый персонаж" }, debts: [debt] as Props["debts"], hideFinance: true });
    expect(screen.queryByText(/Долг/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Имя персонажа"), { target: { value: "Имя" } });
    expect(props.onDraft).toHaveBeenCalledWith(1, "Имя");
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(props.onAddCharacter).toHaveBeenCalledWith(1);
    fireEvent.keyDown(screen.getByLabelText("Имя персонажа"), { key: "Escape" });
    expect(props.onCancelAdding).toHaveBeenCalledOnce();
    rendered.rerender(ui({ ...props, hideFinance: false }));
    fireEvent.click(screen.getByText("Долг 1000 ₽ · 1 игра"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Оплатил" }));
    expect(props.onSettle).toHaveBeenCalledWith(debt);
  });
});
