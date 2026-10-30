// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CampaignCalendarEvent, CampaignDetail, SessionSummary } from "../../types";
import { CampaignChronicle } from "./CampaignChronicle";

const data = vi.hoisted(() => ({
  empty: [],
  calendar: { months: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, position: i + 1, name: `Месяц ${i + 1}`, days: 30 })), weekdays: [], era: "Эстария" },
}));
vi.mock("../../data/hooks", () => ({ useResource: () => ({ data: data.empty, error: null }), useAction: () => vi.fn(), write: {} }));
vi.mock("../../hooks/useSettingCalendar", () => ({ useSettingCalendar: () => data.calendar }));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => [null, vi.fn()], usePrompt: () => [null, vi.fn()] }));
vi.mock("../Timeline", () => ({ Timeline: ({ events }: { events: { title: string }[] }) => <div data-testid="axis-events">{events.map((event) => event.title).join(" · ")}</div> }));
vi.mock("../mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <>{text}</> }));
afterEach(cleanup);

const campaign = { id: 1, setting_id: 1, pinned_calendar_year: null, pinned_calendar_month: null } as CampaignDetail;
const sessions = [{ id: 8, session_number: 18, title: "Клятва", status: "held", inworld_year: 1507, inworld_month: 10, inworld_day: 22 }] as SessionSummary[];
const date = { created_at: "2026-10-30", campaign_id: 1, description: "", important: 0, inworld_year: 1507, inworld_month: 10, inworld_day: 22, date_precision: "day", inworld_year_end: null, inworld_month_end: null, inworld_day_end: null, cancel_note: "" } as const;
const events: CampaignCalendarEvent[] = [
  { ...date, id: 1, title: "Клятва у Белого", status: "happened", source: "campaign" },
  { ...date, id: 2, title: "Совет Пламени", inworld_month: 11, inworld_day: 2, status: "upcoming", source: "campaign" },
  { ...date, id: 3, title: "Отменённый караван", status: "cancelled", source: "campaign" },
  { ...date, id: 1, title: "Пробуждение мира", status: "happened", source: "setting" },
];

describe("Хроника кампании на общем каркасе", () => {
  it("ближайшее после закрепления месяца не берёт просроченный план", () => {
    const { container } = render(<MemoryRouter><CampaignChronicle campaign={{ ...campaign, pinned_calendar_year: 1507, pinned_calendar_month: 11 }} sessions={sessions}
      events={[...events, { ...date, id: 4, title: "Старый план", status: "upcoming", source: "campaign" }]} /></MemoryRouter>);
    expect(container.querySelector(".chr-head__now")?.textContent).toContain("Совет Пламени");
    expect(container.querySelector(".chr-head__now")?.textContent).not.toContain("Старый план");
  });
  it("показывает основу в списке, сессии на оси и сворачивает отменённое", () => {
    const { container } = render(<MemoryRouter><CampaignChronicle campaign={campaign} sessions={sessions} events={events} /></MemoryRouter>);
    expect(container.querySelector(".chr-axis")).toBeTruthy();
    expect(screen.getByTestId("axis-events").textContent).toContain("Клятва у Белого");
    expect(screen.getByTestId("axis-events").textContent).not.toContain("Пробуждение мира");
    expect(screen.getByRole("link", { name: "Пробуждение мира" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Отменённый караван" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Отменено · 1" }));
    expect(screen.getByRole("link", { name: "Отменённый караван" })).toBeTruthy();
  });
  it("календарь телефона возвращает список с фильтром дня и позволяет снять его", () => {
    const { container } = render(<MemoryRouter><CampaignChronicle campaign={campaign} sessions={sessions} events={events} /></MemoryRouter>);
    const mobileTabs = screen.getByRole("tablist", { name: "Вид хроники" });
    fireEvent.click(mobileTabs.querySelectorAll("button")[2]);
    expect(container.querySelector(".chr")?.getAttribute("data-mobile-view")).toBe("Календарь");
    fireEvent.click(screen.getByRole("button", { name: "22 Месяц 10 1507" }));
    expect(container.querySelector(".chr")?.getAttribute("data-mobile-view")).toBe("Список");
    expect(container.querySelector(".chr-list")?.textContent).not.toContain("Совет Пламени");
    fireEvent.click(container.querySelector(".chr-day-filter")!);
    expect(container.querySelector(".chr-list")?.textContent).toContain("Совет Пламени");
  });
});
