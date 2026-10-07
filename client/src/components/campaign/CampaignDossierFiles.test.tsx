// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDndCharacter } from "@shared/dnd/normalize";
import { resourceQuery } from "../../data/hooks";
import { statblockListPath } from "../../data/statblocks";
import type { Character, CompendiumEntry, RosterPlayer } from "../../types";
import { CampaignDossierFiles } from "./CampaignDossierFiles";

const live = vi.hoisted(() => ({ entries: new Map<number, CompendiumEntry>() }));
vi.mock("../dnd/useCompendiumEntries", () => ({ useCompendiumEntries: () => (id: number) => live.entries.get(id) }));
afterEach(() => { cleanup(); live.entries.clear(); });
const roster = [{ id: 1, name: "Колян", roster_status: "active" }, { id: 2, name: "Ксюша", roster_status: "left" }] as RosterPlayer[];
const characters = [
  { id: 10, player_id: 1, character_name: "Ларри" },
  { id: 11, player_id: 1, character_name: "Ролдан", thumbnail_image_url: "javascript:alert(1)" },
  { id: 12, player_id: 2, character_name: "Арья" },
] as Character[];
const key = (id: number) => resourceQuery(statblockListPath("character", id)).queryKey;
function mount(over = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  characters.forEach((c) => client.setQueryData(key(c.id), []));
  const props = { roster, characters, debts: [], currency: "₽", hideFinance: false, addingFor: null, drafts: {},
    onDraft: vi.fn(), onStartAdding: vi.fn(), onCancelAdding: vi.fn(), onAddCharacter: vi.fn(), onPeek: vi.fn(),
    onArchive: vi.fn(), onToggleLeft: vi.fn(), onRemovePlayer: vi.fn(), ...over };
  const ui = (next = props) => <QueryClientProvider client={client}><MemoryRouter><div className="campaign-dossier"><CampaignDossierFiles {...next} /></div></MemoryRouter></QueryClientProvider>;
  const rendered = render(ui());
  return { props, client, rendered, ui };
}
describe("личные дела состава кампании", () => {
  it("keeps multiple characters with their owner and routes each action to the correct record", () => {
    const { props, rendered } = mount();
    expect(rendered.container.querySelectorAll('.dossier-file')).toHaveLength(2);
    expect(rendered.container.querySelector('.dossier-file')?.querySelectorAll('.dossier-character')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Лист персонажа Ролдан' }).getAttribute('href')).toBe('/characters/11');
    expect(screen.getByRole('link', { name: 'Лист персонажа Ролдан' }).querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Быстрый просмотр Ролдан' }));
    expect(props.onPeek).toHaveBeenCalledWith(11);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить персонажа игроку Колян' }));
    expect(props.onStartAdding).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Действия с делом Ксюша' }));
    expect(screen.getByRole('menu', { name: 'Действия с делом Ксюша' })).toBeTruthy();
    expect(rendered.container.querySelector('.context-menu')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Вернуть в состав' }));
    expect(props.onToggleLeft).toHaveBeenCalledWith(2, 'left');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Действия с делом Ксюша' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'В архив: Арья' }));
    expect(props.onArchive).toHaveBeenCalledWith(12, 'Арья');
    expect(screen.queryByText('Сводка отряда')).toBeNull();
  });
  it("opens only one floating menu, supports keyboard navigation and closes on Escape or outside click", () => {
    const { props } = mount();
    const trigger = screen.getByRole('button', { name: 'Действия с делом Колян' });
    fireEvent.click(trigger);
    const first = screen.getByRole('menuitem', { name: 'Игрок покинул кампанию' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'В архив: Ролдан' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Действия с делом Ксюша' }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.queryByRole('menuitem', { name: 'В архив: Ларри' })).toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(props.onArchive).not.toHaveBeenCalled();
  });
  it("derives AC from live equipment effects and refreshes when the sheet changes", async () => {
    const { client } = mount();
    const sheet = { ...emptyDndCharacter(), armorClass: '99', hitPointMax: '43', speed: '30',
      classes: [{ classId: null, className: 'Друид', subclassId: null, subclassName: '', level: 1, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: '' }],
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      equipmentSections: [{ name: '', items: [{ id: 'armor', name: 'Доспех', qty: '1', weight: '', notes: '', equipped: true, entryId: 100 }] }] };
    live.entries.set(100, { data: { effects: [{ id: 'armor', type: 'defense', when: 'always', acBase: { base: 14, abilities: ['dex'] } }] } } as unknown as CompendiumEntry);
    await act(async () => client.setQueryData(key(10), [{ format: 'dnd_character', content: JSON.stringify(sheet) }]));
    const dl = screen.getByLabelText('Характеристики Ларри');
    await waitFor(() => expect([...dl.querySelectorAll('dd')].map((e) => e.textContent)).toEqual(['1', '16', '43', '30']));
    sheet.abilities.dex = 16;
    await act(async () => client.setQueryData(key(10), [{ format: 'dnd_character', content: JSON.stringify(sheet) }]));
    await waitFor(() => expect(dl.querySelectorAll('dd')[1].textContent).toBe('17'));
    await act(async () => client.setQueryData(key(10), [{ format: 'dnd_character', content: '{broken' }]));
    await waitFor(() => expect([...dl.querySelectorAll('dd')].map((e) => e.textContent)).toEqual(['—', '—', '—', '—']));
  });
  it("keeps create/cancel available and respects financial privacy", () => {
    const debt = { player_id: 1, owed: 1000, sessions: 1 };
    const { props, rendered, ui } = mount({ addingFor: 1, drafts: { 1: 'Новый персонаж' }, debts: [debt], hideFinance: true });
    expect(screen.queryByText(/Долг/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Имя персонажа'), { target: { value: 'Имя' } });
    expect(props.onDraft).toHaveBeenCalledWith(1, 'Имя');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(props.onAddCharacter).toHaveBeenCalledWith(1);
    fireEvent.keyDown(screen.getByLabelText('Имя персонажа'), { key: 'Escape' });
    expect(props.onCancelAdding).toHaveBeenCalledOnce();
    rendered.rerender(ui({ ...props, hideFinance: false }));
    expect(screen.getByText('Долг 1000 ₽ · 1 игра')).toBeTruthy();
  });
});
