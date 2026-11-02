// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { CompendiumEntry } from "../../types";
import challengeText from "./__fixtures__/challenges.json?raw";
import { OtherscapeThemesView } from "./OtherscapeThemesView";
import { OtherscapeChallengesView } from "./OtherscapeChallengesView";

vi.mock("../mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("./OtherscapeChallengeBody", () => ({ OtherscapeChallengeBody: ({ name }: { name: string }) => <h3>{name}</h3> }));
afterEach(cleanup);

const entry = (id: number, parent_id: number | null, name: string, extra: Partial<CompendiumEntry> = {}) =>
  ({ id, parent_id, name, system_id: 5, section_id: 8, kind: "mechanic_item", description: "", name_original: "", data: {}, aliases: [], ...extra }) as CompendiumEntry;
const themes = [entry(1, null, "Самость"), entry(2, null, "Мифос"),
  entry(3, 1, "Принадлежность"), entry(4, 2, "Артефакт"),
  entry(5, 3, "Готовые наборы"), entry(6, 5, "Дозор", { description: "Тег: острый слух", aliases: ["Night Watch"] }), entry(7, 4, "Вопросы")];

describe("каталоги Otherscape", () => {
  it("находит книгу по вложенному набору, тегу и синониму; ссылка открывает именно часть книги", () => {
    const show = (query: string, selectedId?: number) => <MemoryRouter><OtherscapeThemesView entries={themes} query={query} onSelect={() => {}} selectedId={selectedId} /></MemoryRouter>;
    const view = render(show("острый слух"));
    expect(screen.getByRole("heading", { name: "Принадлежность" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Готовые наборы/ }).getAttribute("href")).toBe("/systems/5?section=8&entry=5&view=list");
    expect(screen.queryByRole("button", { name: "Артефакт" })).toBeNull();
    view.rerender(show("Night Watch"));
    expect(screen.getByRole("heading", { name: "Принадлежность" })).toBeTruthy();
    view.rerender(show("дозор"));
    expect(screen.getByRole("heading", { name: "Принадлежность" })).toBeTruthy();
    view.rerender(show("несуществующая тема"));
    expect(screen.getByText("Ничего не найдено.")).toBeTruthy();
    view.rerender(show("", 7));
    expect(screen.getByRole("heading", { name: "Артефакт" })).toBeTruthy();
  });

  it("собирает общий алфавит из разных типов силы", () => {
    render(<MemoryRouter><OtherscapeThemesView entries={themes} query="" grouping="alpha" onSelect={() => {}} selectedId={undefined} /></MemoryRouter>);
    const region = screen.getByRole("region", { name: "Темы по алфавиту" });
    expect(within(region).getAllByRole("button").map((button) => button.textContent)).toEqual(["Артефакт", "Принадлежность1 набор"]);
  });

  it("фильтрует реальные испытания по сложности и сохраняет прямой путь в список", () => {
    const cards: { name: string; name_original: string; description: string }[] = JSON.parse(challengeText);
    const executive = cards.find((card) => card.name_original === "Corporate Executive")!;
    const gang = cards.find((card) => card.name_original === "Gang Member")!;
    const entries = [entry(10, null, "Корпорации"), entry(11, null, "Преступники"),
      entry(12, 10, executive.name, executive), entry(13, 11, gang.name, gang)];
    const show = (difficulty: string) => <MemoryRouter><OtherscapeChallengesView entries={entries} query="" difficulty={difficulty} selectedId={12} onSelect={() => {}} /></MemoryRouter>;
    const view = render(show("2"));
    expect(screen.getByRole("heading", { name: gang.name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: executive.name })).toBeNull();
    expect(screen.getByRole("link", { name: "Профиль" }).getAttribute("href")).toBe("/systems/5?section=8&entry=13&view=list");
    view.rerender(show("4"));
    expect(screen.getByRole("heading", { name: executive.name })).toBeTruthy();
    view.rerender(show("0"));
    expect(screen.getByText("Ничего не найдено.")).toBeTruthy();
  });
});
