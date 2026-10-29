// @vitest-environment jsdom
import fixtureText from "./__fixtures__/powerSets.json?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../api/client";
import { OtherscapePowerSetBody } from "./OtherscapePowerSetBody";
import { OtherscapeText } from "./OtherscapeText";
import { parsePowerSetPresentation } from "./powerSetPresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(
  fixtureText
);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Otherscape dossier", () => {
  it("renders title, flavor, mechanic, limit order and native UID page links", async () => {
    const lucky = cards.find(card => card.name_original === "Lucky")!;
    vi.spyOn(api, "get").mockResolvedValue([{ uid: "323df0dc-1d4a-40ef-a35f-8603b6a9ceaf", id: 42, name: "Core Book", type: "note", category: "pdf", file_url: "/files/book.pdf" }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><OtherscapePowerSetBody name={lucky.name} originalName="Lucky" powerSet={parsePowerSetPresentation(lucky.description, "Lucky")!} /></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "Удачливость [Lucky]" })).toBeTruthy();
    expect(container.querySelector("blockquote")?.textContent).toContain("Мифическая сила");
    expect(screen.getByRole("heading", { name: "Stolen Fortune" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Возможные последствия" })).toBeTruthy();
    expect(container.querySelector(".oc-limit-value")?.textContent).toBe("Out of Luck3");
    expect(container.querySelector(".oc-status")?.textContent).toBe("stretched-luck-1");
    expect(container.querySelector(".oc-outcome")?.textContent).toBe("strong hit");
    const original = container.querySelector("details")!;
    expect(original.open).toBe(false);
    fireEvent.click(screen.getByText("Оригинал — Original"));
    expect(original.open).toBe(true);
    expect((await screen.findByRole("link", { name: "Открыть с. 330" })).getAttribute("href")).toBe("/resources/42/read?page=330");
    client.clear();
  });

  it("keeps bold/list Markdown, protects mention labels and renders unsafe markup inert", () => {
    const { container } = render(<OtherscapeText text={'- **Правило.** strong hit и gun-shot-3.\n\n[[being@123456789abc|home|miss]]\n\n<script>alert(1)</script>'} />);
    expect(container.querySelector("li strong")?.textContent).toBe("Правило.");
    expect(container.querySelectorAll(".oc-outcome")).toHaveLength(1);
    expect(container.querySelector(".oc-status")?.textContent).toBe("gun-shot-3");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});
