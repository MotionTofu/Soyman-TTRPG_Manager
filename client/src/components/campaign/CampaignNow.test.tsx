// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CampaignNow } from "./CampaignNow";
import type { SessionSummary } from "../../types";

const fx = vi.hoisted(() => ({ drafts: [] as { id: number; session_id: number | null }[] }));
vi.mock("../../data/hooks", () => ({ useResource: () => ({ data: { records: fx.drafts } }) }));
afterEach(cleanup);

const sessions = [
  { id: 10, date: "2026-10-05", status: "held", title: "Поздняя" },
  { id: 11, date: "2026-09-20", status: "held", title: "Ранняя" },
] as SessionSummary[];

function mount() {
  render(
    <MemoryRouter>
      <CampaignNow campaign={{ id: 5, type: "campaign", status: "active", setting_id: null }} sessions={sessions} onSchedule={vi.fn()} onEdit={vi.fn()} />
    </MemoryRouter>
  );
}

const drafts = (n: number, session: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, session_id: session }));

describe("«Не разобрано» на «Обзоре»", () => {
  it.each([
    [1, "1 черновик ›"],
    [2, "2 черновика ›"],
    [5, "5 черновиков ›"],
    [21, "21 черновик ›"],
  ])("%i — «%s»", (n, label) => {
    fx.drafts = drafts(n, 10);
    mount();
    expect(screen.getByRole("link", { name: label })).toBeTruthy();
  });

  it("ведёт в «Итоги» самой ранней сессии с черновиками", () => {
    fx.drafts = [...drafts(1, 10), { id: 9, session_id: 11 }];
    mount();
    expect(screen.getByRole("link", { name: "2 черновика ›" }).getAttribute("href")).toBe(`/sessions/11?tab=${encodeURIComponent("Итоги")}`);
  });

  it("нет черновиков (или они вне встречи) — строки нет", () => {
    fx.drafts = [{ id: 1, session_id: null }];
    mount();
    expect(screen.queryByText("Не разобрано")).toBeNull();
  });
});
