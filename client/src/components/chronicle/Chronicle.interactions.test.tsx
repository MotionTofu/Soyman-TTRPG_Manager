// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChronicleRow } from "./ChronicleRow";
import { ChronicleMonthStrip } from "./ChronicleMonthStrip";
import { EventParticipants } from "./EventParticipants";
import type { CalendarMonth, CampaignCalendarEvent } from "../../types";

vi.mock("../mentions/MentionText", () => ({ MentionText: ({ text }: { text: string }) => <>{text}</> }));
afterEach(cleanup);
const event: CampaignCalendarEvent = { id: 1, campaign_id: 1, created_at: "2026-10-30", title: "Совет", description: "Описание", inworld_year: 1496, inworld_month: 6, inworld_day: 7, important: 1, date_precision: "day", status: "happened", cancel_note: "", inworld_year_end: null, inworld_month_end: null, inworld_day_end: null };
const months = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, position: i + 1, name: `Месяц ${i + 1}`, days: 30 })) as CalendarMonth[];

describe("связанные виды Хроники", () => {
  it("выбор строки не перехватывает ссылку и действия", () => {
    const select = vi.fn(); const toggle = vi.fn();
    render(<MemoryRouter><ChronicleRow ev={event} tone="past" months={months} href="/campaign-events/1" menu={[]}
      onSelect={select} onToggleImportant={toggle} /></MemoryRouter>);
    fireEvent.click(screen.getByText("Описание"));
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Важное: Совет" }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: "Совет" }));
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("день внутри периода через границу года видит событие и фильтрует список", () => {
    const click = vi.fn();
    render(<ChronicleMonthStrip months={months} weekdays={[]} now={{ year: 1496, month: 1, day: 7 }}
      events={[{ ev: { ...event, inworld_year: 1495, inworld_month: 12, inworld_day: 28, inworld_year_end: 1496, inworld_month_end: 1, inworld_day_end: 10 }, tone: "on" }]}
      onDayClick={click} onDayMenu={vi.fn()} />);
    const day = screen.getByRole("button", { name: "7 Месяц 1 1496" });
    expect(day.title).toBe("Совет");
    fireEvent.click(day);
    expect(click).toHaveBeenCalledWith({ year: 1496, month: 1, day: 7 });
  });
  it("два участника, остаток, сессия и источник сохраняются в общей строке", () => {
    render(<MemoryRouter><EventParticipants event={{ ...event, source: "setting", participants: [1, 2, 3].map((id) => ({ id, type: "location", name: `Место ${id}` })),
      sessions: [{ id: 8, link_id: 1, event_id: 1, campaign_id: 1, date: "2026-10-30", title: "Совет", status: "held", session_number: 18 }] }} /></MemoryRouter>);
    expect(screen.getByText("Место 1")).toBeTruthy();
    expect(screen.queryByText("Место 3")).toBeNull();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("Сессия №18")).toBeTruthy();
    expect(screen.getByText("мир")).toBeTruthy();
  });
});
