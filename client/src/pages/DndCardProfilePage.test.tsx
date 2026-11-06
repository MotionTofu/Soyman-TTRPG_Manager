// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { CompendiumEntry } from "../types";
import { DndCardProfilePage } from "./DndCardProfilePage";

const fixture = vi.hoisted(() => ({ entry: {} as CompendiumEntry, entries: [] as CompendiumEntry[], post: vi.fn() }));
vi.mock("../data/hooks", () => ({ useEntity: () => ({ data: fixture.entry, reload: vi.fn() }), useAction: () => async (fn: () => Promise<unknown>) => fn(), write: { put: vi.fn(), post: fixture.post }, useResource: (path: string) => ({ data: path?.endsWith("/sections") ? [{ id: 2, kind: "class", name: "Классы" }] : path?.includes("?section_id=") ? fixture.entries : { id: 1, name: "D&D 5.5", code: "phb" } }) }));
vi.mock("../components/dnd/DndCards", () => ({ CardPicture: ({ name }: { name: string }) => <img alt={name} src="/card.webp" /> }));
vi.mock("../components/mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("../components/EntityPreviewModal", () => ({ EntityPreviewModal: ({ children }: { children: React.ReactNode }) => <div role="dialog" aria-label="Упоминание">{children}</div> }));
vi.mock("../components/EntryImagesTab", () => ({ EntryImagesTab: ({ entryId }: { entryId: number }) => <div>Галерея записи {entryId}</div> }));
vi.mock("../components/MentionsTab", () => ({ MentionsTab: ({ entityId }: { entityId: number }) => <div>Упоминания записи {entityId}</div> }));
vi.mock("../components/dnd/EffectList", () => ({ EffectList: () => null }));

beforeEach(() => {
  fixture.post.mockReset();
  fixture.entry = { id: 5, aliases: [], short_name: null, created_at: "2026-11-06", name_original: "", system_id: 1, section_id: 2, kind: "class", name: "Воин", description: "Первый абзац.\n\nВторой абзац.\n\nТретий абзац.", position: 0, parent_id: null, level: null, data: { hit_die: "к10", short_description: "Мастер оружия.", subclass_level: "3", equipment_a: "Кольчуга", progression: { columns: [{ key: "lvl", label: "Уровень", role: "level" }, { key: "feat", label: "Умения класса", role: "features" }, { key: "pool", label: "Второе дыхание", role: "resource", recharge: "short" }], rows: [{ lvl: "1", feat: "Второе дыхание", pool: "2" }, { lvl: "3", feat: "Подкласс воина", pool: "2" }, { lvl: "7", feat: "Умение подкласса", pool: "3" }] } } } as CompendiumEntry;
  fixture.entries = [fixture.entry, { ...fixture.entry, id: 11, kind: "feature", name: "Второе дыхание", description: "Текст умения", parent_id: 5, level: 1, data: {} }, { ...fixture.entry, id: 6, kind: "subclass", name: "Чемпион", parent_id: 5, data: {} }, { ...fixture.entry, id: 7, kind: "subclass", name: "Мистический рыцарь", parent_id: 5, data: { progression: { columns: [{ key: "level", label: "Уровень", role: "level" }, { key: "slot", label: "Ячейки 1", role: "slot1" }], rows: [{ level: "3", slot: "2" }, { level: "7", slot: "4" }] } } }];
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
function Address() { return <span data-testid="address">{useLocation().search}</span>; }
function show(tab = "") { return render(<MemoryRouter initialEntries={[`/systems/1/entries/5${tab}`]}><Address /><Routes><Route path="/systems/:id/entries/:entryId" element={<DndCardProfilePage />} /><Route path="/systems/:id" element={<div>Редактор раздела</div>} /></Routes></MemoryRouter>); }

it("досье использует герой профиля и раскрывает умение общей статьёй", () => {
  const { container } = show();
  expect(container.querySelector(".entity-page--profile")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Воин", level: 1 })).toBeTruthy();
  expect(screen.getByText("Мастер оружия.")).toBeTruthy();
  expect(screen.queryByText(/Третий абзац/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Второе дыхание" }));
  expect(screen.getByRole("article", { name: "Умение класса: Второе дыхание" }).textContent).toContain("Текст умения");
  expect(container.querySelector(".dc-spread")).toBeNull();
});
it("развитие читает столбцы данных, отдых и уровни подкласса", () => {
  const { container } = show("?tab=Развитие");
  expect(screen.getByRole("columnheader", { name: /Второе дыхание.*↻ короткий/ })).toBeTruthy();
  expect([...container.querySelectorAll("tr.is-subclass-level")].map((row) => row.firstElementChild?.textContent)).toEqual(["3", "7"]);
  fireEvent.click(screen.getByRole("button", { name: "Второе дыхание" }));
  expect(within(screen.getByRole("dialog", { name: "Упоминание" })).getByRole("article")).toBeTruthy();
});
it("добавляет справа только существующие колонки подкласса по номеру уровня", () => {
  const { container } = show("?tab=Развитие");
  expect(screen.queryByRole("option", { name: "+ Чемпион" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Столбцы подкласса" }), { target: { value: "7" } });
  expect(screen.getByRole("columnheader", { name: "Мистический рыцарь · Ячейки 1" })).toBeTruthy();
  const rows = container.querySelectorAll("tbody tr");
  expect([...rows].map((row) => row.lastElementChild?.textContent)).toEqual(["—", "2", "4"]);
});
it("вид без short_description не получает выдуманный фокус и читает сопротивление черты", () => {
  fixture.entry = { ...fixture.entry, kind: "species", name: "Дварф", data: { size: "Средний", senses: [{ id: 90, name: "Тёмное зрение", distance: "120" }], speeds: [{ id: 91, name: "Ходьба", distance: "30" }] } };
  fixture.entries = [fixture.entry, { ...fixture.entries[1], data: { effects: [{ id: "r", type: "resistance", damageType: { id: 92, name: "Ядовитый" } }] } }];
  show();
  expect(screen.queryByText("В двух словах")).toBeNull();
  expect(screen.queryByRole("tab", { name: /Развитие/ })).toBeNull();
  expect(screen.getByText("Ядовитый", { exact: false })).toBeTruthy();
  expect(screen.getAllByText("120 фт.", { exact: false })).toHaveLength(2);
});
it("подкласс имеет крошку родителя и три служебных вкладки без Подклассов", () => {
  fixture.entry = fixture.entries[2];
  show();
  expect(screen.queryByRole("tab", { name: /Подклассы/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Воин" }).getAttribute("href")).toBe("/systems/1/entries/5");
  fireEvent.click(screen.getByRole("tab", { name: "Галерея" }));
  expect(screen.getByText("Галерея записи 6")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Упоминания" }));
  expect(screen.getByText("Упоминания записи 6")).toBeTruthy();
});
