// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SceneDetailPage } from "./SceneDetailPage";

const model = vi.hoisted(() => ({ status: "done", writes: [] as { path: string; body: Record<string, unknown> }[] }));
vi.mock("../api/client", () => ({ api: {
  get: vi.fn(async (path: string) => {
    const scene = { id: 484, setting_id: 1, arc_id: 156, name: "Комната", source_scene_id: 472, is_override: true, node_role: "start", created_at: "2026-11-05", summary: "Сводка", read_aloud: "", whats_happening: "", twists: "", pressure: "", cut_when: "", hidden_from_players: 1, entry_condition: "", outcomes: "", state: { status: model.status, note: "" }, checks: [], rewards: [], transitions: [] };
    if (path.startsWith("/story/scenes/472?")) return structuredClone(scene);
    if (path.startsWith("/story/scenes?")) return [scene];
    if (path.includes("/presentation")) return { background_url: null, layers: [] };
    if (path.includes("profile-clues")) return { incoming: [], outgoing: [] };
    if (path.includes("/clues")) return { nodes: [], clues: [] };
    if (path.includes("campaign-tree")) return [];
    if (path === "/story/arcs/156") return { id: 156, name: "Дело", parent_id: null };
    if (path === "/settings/1" || path === "/campaigns/31") return { id: 1, name: "Мир" };
    return [];
  }),
  put: vi.fn(async (path: string, body: Record<string, unknown>) => { model.writes.push({ path, body }); model.status = String(body.status); return { status: model.status }; }),
  post: vi.fn(), del: vi.fn(),
} }));
vi.mock("../dataSync", () => ({ notifyDataChanged: vi.fn(), onDataChangedElsewhere: () => () => {} }));
vi.mock("../components/SectionDropZone", () => ({ SectionDropZone: () => null }));
vi.mock("../components/mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("../components/mentions/MentionTextarea", () => ({ MentionTextarea: () => null }));
afterEach(cleanup);

describe("статус копии через URL оригинала", () => {
  it("обновляет чип без перезагрузки и пишет в id копии", async () => {
    model.status = "done"; model.writes.length = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/scenes/472?campaign=31"]}><Routes><Route path="/scenes/:id" element={<SceneDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Пройдена ▾" }));
    fireEvent.click(screen.getByRole("button", { name: "Не начата" }));
    expect(await screen.findByRole("button", { name: "Не начата ▾" })).toBeTruthy();
    expect(model.writes).toEqual([{ path: "/story/scenes/484/state", body: { campaign_id: 31, status: "pending" } }]);
    client.clear();
  });
});
