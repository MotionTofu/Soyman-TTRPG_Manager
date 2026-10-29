// @vitest-environment jsdom
import fixtureText from "./__fixtures__/equipment.json?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../api/client";
import { OtherscapeEquipmentBody } from "./OtherscapeEquipmentBody";
import { parseEquipmentPresentation } from "./equipmentPresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(fixtureText);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function dossier(name: string) {
  const item = cards.find(card => card.name_original === name)!;
  vi.spyOn(api, "get").mockResolvedValue([{ uid: "323df0dc-1d4a-40ef-a35f-8603b6a9ceaf", id: 42, name: "Core Book", type: "note", category: "pdf", file_url: "/files/book.pdf" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><OtherscapeEquipmentBody name={item.name} originalName={name} equipment={parseEquipmentPresentation(item.description, name)!} /></QueryClientProvider>) };
}

describe("Equipment dossier reading", () => {
  it("shows translated and English tags, primary-tag order, weakness and a portable page link", async () => {
    const { container, client } = dossier("Certified corp ID");
    expect(screen.getByRole("heading", { name: "Корпоративное удостоверение [Certified corp ID]" })).toBeTruthy();
    expect(container.querySelector("blockquote")?.textContent).toContain("Настоящее корпоративное удостоверение");
    const tags = container.querySelectorAll(".oc-loadout-tags > li");
    expect(tags).toHaveLength(3);
    expect(tags[0].textContent).toContain("Основной тегcertified corp ID");
    expect(screen.getByRole("complementary", { name: "Слабость — Weakness" }).textContent).toContain("full authentication also requires PIN");
    expect(container.querySelector(".oc-equipment-notes")?.textContent).toContain("Каждый тег набора загружается отдельно");
    expect(container.querySelector(".oc-difficulty")).toBeNull();
    const original = container.querySelector("details")!;
    expect(original.open).toBe(false);
    fireEvent.click(screen.getByText("Оригинал — Original"));
    expect(original.open).toBe(true);
    expect(original.textContent).toContain("It’s not yours.");
    expect((await screen.findByRole("link", { name: "Открыть с. 254" })).getAttribute("href")).toBe("/resources/42/read?page=254");
    client.clear();
  });

  it("keeps general Items / Features / Flaws separate, including original spelling", () => {
    const { container, client } = dossier("General Items / Vehicles");
    expect(screen.getByRole("heading", { name: "Предметы [Items]" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Признаки [Features]" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Слабости [Flaws]" })).toBeTruthy();
    expect(container.querySelectorAll(".oc-loadout-tags > li")).toHaveLength(17);
    expect(container.querySelector(".oc-generic-sections")?.textContent).toContain("hand glider");
    expect(container.querySelector(".oc-equipment-notes")?.textContent).toContain("по смыслу речь о дельтаплане");
    client.clear();
  });

  it("keeps Special frequency visible and its original expandable", () => {
    const { container, client } = dossier("Deeply Customizable");
    expect(container.querySelector(".oc-equipment-special")?.textContent).toContain("Один раз за Downtime");
    expect(container.querySelector("details")?.textContent).toContain("Once per downtime");
    expect(container.querySelector(".oc-equipment-weakness")).toBeNull();
    client.clear();
  });

  it("keeps every source-page action for a Loadout rule", async () => {
    const { container, client } = dossier("Wildcard Loadout Tags");
    expect(container.querySelector(".oc-reference-text")?.textContent).toContain("2 Power за wildcard loadout tag");
    for (const page of [114, 115, 116, 140]) expect((await screen.findByRole("link", { name: `Открыть с. ${page}` })).getAttribute("href")).toBe(`/resources/42/read?page=${page}`);
    expect(container.querySelectorAll(".oc-source-actions a")).toHaveLength(4);
    client.clear();
  });
});
