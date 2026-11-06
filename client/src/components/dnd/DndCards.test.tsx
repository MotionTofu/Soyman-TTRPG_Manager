// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CompendiumEntry } from "../../types";
import { CardGrid, CardScroll, CardSpread } from "./DndCards";

const fixture = vi.hoisted(() => ({ mobile: false, entry: {} as CompendiumEntry, features: [] as CompendiumEntry[] }));
vi.mock("../../hooks/useIsMobile", () => ({ useIsMobile: () => fixture.mobile }));
vi.mock("../../data/imperative", () => ({ readResource: () => Promise.resolve(fixture.entry) }));
vi.mock("./dndCompendium", () => ({ loadDndClassFeatures: () => Promise.resolve(fixture.features), loadDndSpeciesFeatures: () => Promise.resolve(fixture.features) }));
vi.mock("../mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
beforeEach(() => {
  fixture.mobile = false;
  fixture.entry = { id: 5, aliases: [], short_name: null, created_at: "2026-11-06", name_original: "", system_id: 1, section_id: 2, kind: "class", name: "Воин", description: "Прежний свиток класса", level: null, parent_id: null, position: 0, avatar_image_url: "/cards/fighter.webp", data: { hit_die: "к10", progression: { columns: [{ key: "level", label: "Уровень", role: "level" }, { key: "features", label: "Умения", role: "features" }], rows: [{ level: "1", features: "Второе дыхание" }, { level: "2", features: "Всплеск действий" }] } } } as CompendiumEntry;
  fixture.features = [{ ...fixture.entry, id: 11, kind: "feature", name: "Второе дыхание", description: "Текст второго дыхания", level: 1, data: {} }, { ...fixture.entry, id: 12, kind: "feature", name: "Всплеск действий", description: "Текст всплеска", level: 2, data: {} }];
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

it("визард сохраняет свиток и окно таблицы на ПК", () => {
  render(<MemoryRouter><CardScroll entry={fixture.entry} features={fixture.features} anchorPrefix="wizard" /></MemoryRouter>);
  expect(screen.getByText("Прежний свиток класса")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Открыть таблицу развития класса" }));
  const dialog = screen.getByRole("dialog", { name: "Таблица развития: Воин" });
  expect(within(dialog).getByRole("table")).toBeTruthy();
  expect(dialog.querySelector(".is-current")).toBeNull();
});
it("лист сохраняет лицо карты, currentLevel и приглушение будущих уровней", async () => {
  render(<MemoryRouter><CardSpread systemId={1} entryId={5} currentLevel={1} /></MemoryRouter>);
  expect(await screen.findByRole("img", { name: "Воин" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Открыть таблицу развития класса" }));
  const dialog = screen.getByRole("dialog", { name: "Таблица развития: Воин" });
  expect(dialog.querySelector("tr.is-current")?.textContent).toContain("Второе дыхание");
  expect(dialog.querySelector("tr.is-ahead")?.textContent).toContain("Всплеск действий");
});
it("мобильный лист по-прежнему переворачивает карту и показывает текущий уровень", async () => {
  fixture.mobile = true;
  render(<MemoryRouter><CardSpread systemId={1} entryId={5} currentLevel={1} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Воин: описание" }));
  fireEvent.click(screen.getByRole("button", { name: "Открыть таблицу развития класса" }));
  const dialog = screen.getByRole("dialog", { name: "Таблица развития: Воин" });
  expect(dialog.textContent).toContain("сейчас 1 уровень");
  expect(dialog.querySelector(".is-current")).toBeTruthy();
  expect(dialog.querySelector(".is-ahead")).toBeTruthy();
});
it("сетка визарда передаёт выбор прежней карты", () => {
  const pick = vi.fn();
  render(<MemoryRouter><CardGrid options={[{ id: 5, name: "Воин", card: "/cards/fighter.webp" }]} selectedId={5} collapsed onPick={pick} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /Воин/ }));
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ id: 5, name: "Воин" }));
});
