// @vitest-environment jsdom
import fixtureText from "./__fixtures__/crew.json?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../api/client";
import { OtherscapeCrewBody } from "./OtherscapeCrewBody";
import { parseCrewPresentation } from "./crewPresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(fixtureText);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function dossier(name: string) {
  const item = cards.find(card => card.name_original === name)!;
  vi.spyOn(api, "get").mockResolvedValue([{ uid: "323df0dc-1d4a-40ef-a35f-8603b6a9ceaf", id: 42, name: "Core Book", type: "note", category: "pdf", file_url: "/files/book.pdf" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><OtherscapeCrewBody name={item.name} originalName={name} crew={parseCrewPresentation(item.description, name)!} /></QueryClientProvider>) };
}

describe("Crew dossier reading", () => {
  it("presents every kit option, motivation and source without selection controls", async () => {
    const { container, client } = dossier("Found Family");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("[Found Family]");
    expect(screen.getByRole("region", { name: "Теги силы" }).querySelectorAll("li")).toHaveLength(10);
    expect(screen.getByRole("complementary", { name: "Теги слабости" }).querySelectorAll("li")).toHaveLength(4);
    expect(screen.getAllByText("Титульный тег")).toHaveLength(1);
    expect(container.querySelector(".oc-crew-motivation")?.textContent).toContain("We’re in this together.");
    expect(container.querySelector(".oc-related")?.textContent).toContain("опечатка сохранена");
    expect(screen.getByText("OUR SHARED APARTMENTMENT BASE")).toBeTruthy();
    expect((await screen.findByRole("link", { name: "Открыть с. 156" })).getAttribute("href")).toBe("/resources/42/read?page=156");
    expect(container.querySelector("input,select,.oc-difficulty")).toBeNull();
    client.clear();
  });

  it("highlights the Special, roll outcomes and reveals the complete original", async () => {
    const { container, client } = dossier("Last Second Leap");
    expect(container.querySelector(".oc-crew-special")?.textContent).toContain("Оба игрока могут выполнять Mitigate");
    expect(container.querySelectorAll(".oc-outcome")).toHaveLength(2);
    expect(container.querySelector("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("Оригинал — Original"));
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("details")?.textContent).toContain("the helper PC suffers the same Consequences");
    expect((await screen.findByRole("link", { name: "Открыть с. 155" })).getAttribute("href")).toBe("/resources/42/read?page=155");
    client.clear();
  });

  it("separates bilingual questions into readable pairs and preserves all source pages", async () => {
    const { container, client } = dossier("Power Tag Questions / Weakness Tag Questions");
    expect(screen.getByRole("heading", { name: "Вопросы тегов силы [Power Tag Questions]" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Вопросы тегов слабости [Weakness Tag Questions]" })).toBeTruthy();
    expect(container.querySelectorAll(".oc-crew-pairs > li")).toHaveLength(14);
    expect(container.querySelectorAll(".oc-crew-pair-original")).toHaveLength(14);
    expect(container.querySelector(".oc-crew-list-after")?.textContent).toContain("A и I совпадают");
    for (const page of [155, 190]) expect((await screen.findByRole("link", { name: `Открыть с. ${page}` })).getAttribute("href")).toBe(`/resources/42/read?page=${page}`);
    client.clear();
  });

  it("keeps all thirty-five relationship examples and restrictions in view", () => {
    const { container, client } = dossier("Crew Relationship Tags");
    expect(screen.getByRole("heading", { name: "Примеры [Relationship Tags]" })).toBeTruthy();
    expect(container.querySelectorAll(".oc-crew-pairs > li")).toHaveLength(35);
    expect(container.querySelector(".oc-crew-reference")?.textContent).toContain("не принадлежат теме");
    expect(screen.getByText("work well together")).toBeTruthy();
    client.clear();
  });
});
