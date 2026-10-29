// @vitest-environment jsdom
import fixtureText from "./__fixtures__/challenges.json?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../api/client";
import { OtherscapeChallengeBody } from "./OtherscapeChallengeBody";
import { parseChallengePresentation } from "./challengePresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(fixtureText);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function dossier(name: string) {
  const item = cards.find(card => card.name_original === name)!;
  vi.spyOn(api, "get").mockResolvedValue([{ uid: "323df0dc-1d4a-40ef-a35f-8603b6a9ceaf", id: 42, name: "Core Book", type: "note", category: "pdf", file_url: "/files/book.pdf" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><OtherscapeChallengeBody name={item.name} originalName={name} challenge={parseChallengePresentation(item.description, name)!} /></QueryClientProvider>) };
}

describe("Challenge dossiers", () => {
  it("renders a real profile with English names, correct limit order and paired consequences", async () => {
    const { container, client } = dossier("Corporate Executive");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("[Corporate Executive]");
    expect(container.querySelector(".oc-difficulty")?.textContent).toBe("4Сложность");
    expect(container.querySelector("blockquote")?.textContent).toContain("Browbeaten");
    expect(screen.getByRole("heading", { name: "Lawyered Up" })).toBeTruthy();
    expect(container.querySelector(".oc-limit-value")?.textContent).toBe("Bribe–Подкупить · иммунитет");
    expect(container.querySelector(".oc-status")?.textContent).toBe("asset-protection-3");
    const threats = container.querySelectorAll(".oc-threat-list > li");
    expect(threats).toHaveLength(4);
    expect(threats[1].textContent).toContain("сжигает до двух тегов");
    expect(threats[1].textContent).not.toContain("вызывает Security Guard");
    const original = container.querySelector("details")!;
    expect(original.open).toBe(false);
    expect(original.textContent).toContain("Bodyguards: When");
    fireEvent.click(screen.getByText("Оригинал — Original"));
    expect(original.open).toBe(true);
    expect((await screen.findByRole("link", { name: "Открыть с. 304" })).getAttribute("href")).toBe("/resources/42/read?page=304");
    client.clear();
  });

  it("renders Scale separately from a power-set bonus and keeps the per-scene restriction", () => {
    const { container, client } = dossier("The Lady");
    expect(container.querySelector(".oc-difficulty")?.textContent).toBe("+2К сложности");
    expect(container.querySelector(".oc-scale")?.textContent).toBe("3Масштаб [Scale]");
    expect(screen.getByRole("heading", { name: "Unleash Hell!" }).parentElement?.textContent).toContain("раз за сцену");
    expect(container.querySelector(".oc-limits")?.textContent).toContain("до конца следующего Downtime");
    client.clear();
  });

  it("keeps every page action together for profiles spanning multiple pages", async () => {
    const item = cards.find(card => card.name_original === "Arman Farzin")!;
    const pages = parseChallengePresentation(item.description, item.name_original)!.pages;
    const { container, client } = dossier("Arman Farzin");
    expect(pages).toHaveLength(2);
    for (const page of pages) expect((await screen.findByRole("link", { name: `Открыть с. ${page.page}` })).getAttribute("href")).toBe(`/resources/42/read?page=${page.page}`);
    expect(container.querySelectorAll(".oc-source-actions a")).toHaveLength(2);
    client.clear();
  });
});
