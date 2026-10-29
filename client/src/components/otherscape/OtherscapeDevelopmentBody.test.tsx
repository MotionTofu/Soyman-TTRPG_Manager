// @vitest-environment jsdom
import fixtureText from "./__fixtures__/development.json?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../api/client";
import { OtherscapeDevelopmentBody } from "./OtherscapeDevelopmentBody";
import { parseDevelopmentPresentation } from "./developmentPresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(fixtureText);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function dossier(name: string) {
  const item = cards.find(card => card.name_original === name)!;
  vi.spyOn(api, "get").mockResolvedValue([{ uid: "323df0dc-1d4a-40ef-a35f-8603b6a9ceaf", id: 42, name: "Core Book", type: "note", category: "pdf", file_url: "/files/book.pdf" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><OtherscapeDevelopmentBody name={item.name} originalName={name} development={parseDevelopmentPresentation(item.description, name)!} /></QueryClientProvider>) };
}

describe("Development dossier reading", () => {
  it("shows an essence's actual composition and Special, with its original and portable source", async () => {
    const { container, client } = dossier("Spiritualist");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("[Spiritualist]");
    expect(screen.getByRole("heading", { name: "Особенность эссенции [Essence Special]" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Состав тем" }).textContent).toContain("тем Noise нет");
    expect(container.querySelector(".oc-main-rules")?.textContent).toContain("одна общая возможность за сессию");
    expect(container.querySelector("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("Оригинал — Original"));
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("details")?.textContent).toContain("SPIRITUALIST (SELF AND MYTHOS)");
    expect(container.querySelector(".oc-related")?.textContent).toContain("Бросок с Self, Mythos или Noise");
    expect((await screen.findByRole("link", { name: "Открыть с. 135" })).getAttribute("href")).toBe("/resources/42/read?page=135");
    expect(container.querySelector("input")).toBeNull();
    client.clear();
  });

  it("keeps the five-box/two-upgrade Veteran rule and its full English original", () => {
    const { container, client } = dossier("Slow & Steady");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("[Slow & Steady]");
    expect(container.querySelector(".oc-development-mechanic")?.textContent).toContain("5 клеток вместо 3");
    expect(container.querySelector(".oc-development-mechanic")?.textContent).toContain("два улучшения");
    expect(container.querySelector("details")?.textContent).toContain("5 boxes instead of 3");
    expect(container.querySelector(".oc-difficulty")).toBeNull();
    client.clear();
  });

  it("highlights the reward formula without a calculator and keeps both source pages", async () => {
    const { container, client } = dossier("Gain Evolution Points");
    expect(container.querySelector(".oc-rule-formula code")?.textContent).toBe("1 + max(0, P − 3) + max(0, W − 1) + S");
    expect(container.querySelector(".oc-rule-formula")?.textContent).toContain("Частично заполненный Upgrade track отдельно очков не даёт");
    expect(container.querySelector("input")).toBeNull();
    for (const page of [138, 140]) expect((await screen.findByRole("link", { name: `Открыть с. ${page}` })).getAttribute("href")).toBe(`/resources/42/read?page=${page}`);
    client.clear();
  });

  it("keeps all five upgrade-choice links and the Slow & Steady exception", () => {
    const { container, client } = dossier("Upgrade Track / Choosing Upgrades");
    expect(screen.getByRole("heading", { name: "Варианты [Choosing Upgrades]" })).toBeTruthy();
    expect(container.querySelectorAll(".oc-development-rule li")).toHaveLength(5);
    expect(container.querySelector(".oc-development-rule")?.textContent).toContain("Slow & Steady");
    client.clear();
  });
});
