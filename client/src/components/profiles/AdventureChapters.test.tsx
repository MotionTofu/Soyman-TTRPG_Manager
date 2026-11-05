// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CampaignTreeScene } from "../../types";
import { SceneList } from "../CampaignChaptersScenes";
import { adventureFacts } from "./AdventureDossier";

const scene = { id: 9, name: "Узел", arc_id: 3, node_role: "normal", node_type: "", summary: "", state: { status: "done" }, sessions: [{ id: 1, number: 4, date: "2026-01-01", played: true }], makeup: { characters: [], locations: [], obstacles: [], loot: [] } } as unknown as CampaignTreeScene;
const html = (campaignId: number | null) => {
  const client = new QueryClient();
  const result = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><SceneList scenes={[scene]} campaignId={campaignId} settingId={1} title={null} clues={undefined} nodeBy={new Map()} /></MemoryRouter></QueryClientProvider>);
  client.clear();
  return result;
};
afterEach(cleanup);
function Path() { const p = useLocation(); return <output aria-label="Адрес">{p.pathname}{p.search}</output>; }
describe("общая строка глав приключения", () => {
  it("в основе не показывает статусы, сессии и кампанийные ссылки", () => {
    const result = html(null);
    expect(result).not.toContain("campaign-scene__mark");
    expect(result).not.toContain("campaign-scene__session");
    expect(result).not.toContain("Сессия №");
    expect(result).not.toContain("campaign=null");
    expect(result).not.toContain("Статус сцены");
    expect(result).toContain("Действия сцены");
  });
  it("в кампании сохраняет отметку, общую сессию и статусное меню Сюжета", () => {
    const result = html(2);
    expect(result).toContain("campaign-scene__mark");
    expect(result).toContain("Сессия №4");
    expect(result).toContain("Статус сцены");
    expect(result).toContain("Запускалась в №4");
  });
  it.each([null, 2])("открывает сцену с сохранением контекста %s", async (campaignId) => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><MemoryRouter><SceneList scenes={[scene]} campaignId={campaignId} settingId={1} title={null} clues={undefined} nodeBy={new Map()} /><Path /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Открыть сцену", hidden: true }));
    expect(screen.getByLabelText("Адрес").textContent).toBe(`/scenes/9${campaignId ? "?campaign=2" : ""}`);
    client.clear();
  });
  it("передаёт перетаскивание в сортировку общего списка", () => {
    const client = new QueryClient(), reorder = vi.fn();
    render(<QueryClientProvider client={client}><MemoryRouter><SceneList scenes={[scene, { ...scene, id: 10, name: "Второй" }]} campaignId={null} settingId={1} title={null} clues={undefined} nodeBy={new Map()} reorder={reorder} /></MemoryRouter></QueryClientProvider>);
    const first = screen.getByText("Узел").closest("details")!;
    const second = screen.getByText("Второй").closest("details")!;
    fireEvent.dragStart(first);
    fireEvent.dragOver(second);
    fireEvent.drop(second);
    expect(reorder).toHaveBeenCalledExactlyOnceWith(9, 10);
    client.clear();
  });
  it("не выдумывает паспортные значения и не удваивает единицы", () => {
    expect(adventureFacts({ recommended_level: "", player_count: "", duration: "" })).toEqual([]);
    expect(adventureFacts({ recommended_level: "3–5", player_count: "4", duration: "3" })).toEqual(["ур. 3–5", "4 игрока", "3 ч"]);
    expect(adventureFacts({ recommended_level: "", player_count: "4 игрока", duration: "3 ч" })).toEqual(["4 игрока", "3 ч"]);
  });
});
