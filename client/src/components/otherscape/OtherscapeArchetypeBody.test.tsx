// @vitest-environment jsdom
import fixtureText from "./__fixtures__/archetypes.json?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../api/client";
import * as mentions from "../../mentions";
import { OtherscapeArchetypeBody } from "./OtherscapeArchetypeBody";
import { parseArchetypePresentation } from "./archetypePresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(fixtureText);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function dossier(name: string, change: (text: string) => string = text => text) {
  const item = cards.find(card => card.name_original === name)!;
  vi.spyOn(mentions, "isMentionIndexReady").mockReturnValue(true);
  vi.spyOn(mentions, "resolveMention").mockReturnValue(101);
  vi.spyOn(api, "get").mockResolvedValue([{ uid: "323df0dc-1d4a-40ef-a35f-8603b6a9ceaf", id: 42, name: "Core Book", type: "note", category: "pdf", file_url: "/files/book.pdf" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><OtherscapeArchetypeBody name={item.name} originalName={name} archetype={parseArchetypePresentation(change(item.description), name)!} /></QueryClientProvider>) };
}

describe("Character trope dossier reading", () => {
  it("separates three base kits from the one-of-three choice and retains native links", async () => {
    const { container, client } = dossier("CORPO-WAR SNIPER");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Снайпер корпоративных войн [CORPO-WAR SNIPER]");
    const base = screen.getByRole("region", { name: "Три основных набора" });
    const choice = screen.getByRole("region", { name: "Четвёртый набор: выберите один" });
    expect(base.querySelectorAll("li")).toHaveLength(3);
    expect(choice.querySelectorAll("li")).toHaveLength(3);
    expect(base.querySelectorAll("button.mention-link")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Chipped Weapon Mastery/ })).toBeTruthy();
    expect(choice.textContent).toContain("для одной четвёртой темы");
    expect(container.querySelector("blockquote")?.textContent).toContain("один решающий выстрел");
    expect((await screen.findByRole("link", { name: "Открыть с. 178" })).getAttribute("href")).toBe("/resources/42/read?page=178");
    expect(screen.getByRole("link", { name: "Core Book, с. 238" }).getAttribute("href")).toBe("/resources/42/read?page=238");
    expect(container.querySelector("input,select,.oc-difficulty")).toBeNull();
    client.clear();
  });

  it("keeps shared weaknesses visible and reveals the complete original Loadout", () => {
    const { container, client } = dossier("FARSEEING SPY");
    const loadout = screen.getByRole("region", { name: "Начальное снаряжение" });
    expect(loadout.textContent).toContain("Для всех трёх: уличающие (incriminating)");
    expect(loadout.querySelector("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("Оригинал — Loadout"));
    expect(loadout.querySelector("details")?.open).toBe(true);
    expect(loadout.querySelector("details")?.textContent).toContain("concealed pistol (all: incriminating)");
    expect(container.querySelector(".oc-archetype-creation")?.textContent).toContain("Identity, Ritual или Itch");
    client.clear();
  });

  it("retains spelling notes and renders changed descriptions without omitting content", () => {
    const { container, client } = dossier("HIGH-TECH SHINOBI", text => text.replace("**Три основных набора — Base Theme Kits**", "**Свои наборы**"));
    expect(container.querySelector(".oc-archetype-themes")).toBeNull();
    expect(container.querySelector(".oc-reference-text")?.textContent).toContain("соответствующий набор на с. 234 озаглавлен");
    expect(screen.getByRole("button", { name: /Animated Shadows/ })).toBeTruthy();
    expect(container.textContent).toContain("all: short ranged");
    client.clear();
  });
});
