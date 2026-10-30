// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Timeline, type TimelineEvent } from "../Timeline";
import type { CalendarMonth } from "../../types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("важное событие сохраняет подпись рядом со слипшимися обычными", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const base: TimelineEvent = { id: 1, title: "Клятва у Белого", year: 1507, month: 10, day: 22, precision: "day", year_end: null, month_end: null, day_end: null, status: "happened", important: true };
  const months = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, position: i + 1, name: String(i + 1), days: 30 })) as CalendarMonth[];
  render(<Timeline events={[base, ...[2, 3, 4].map((id) => ({ ...base, id, title: `Обычное ${id}`, important: false }))]} months={months} era="" now={{ year: 1507, month: 10, day: 22 }} />);
  expect(screen.getByText("Клятва у Белого")).toBeTruthy();
  expect(screen.getByRole("button", { name: "3" })).toBeTruthy();
});
