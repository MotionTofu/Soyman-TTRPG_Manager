import { describe, expect, it } from "vitest";
import { campaignClock, eventOccursOn, timeTone, type TonedEvent } from "./time";
import type { SessionSummary } from "../../types";

const now = { year: 1496, month: 6, day: 7 };
const event: TonedEvent = { inworld_year: 1496, inworld_month: 6, inworld_day: 1, inworld_year_end: 1496, inworld_month_end: 6, inworld_day_end: 24, status: "upcoming" };

describe("общее время Хроники (перенос codex/campaign-chronicle)", () => {
  it("только период, включая оба конца, получает тон «идёт»", () => {
    for (const day of [1, 7, 24]) expect(timeTone(event, { ...now, day })).toBe("on");
    expect(timeTone({ ...event, inworld_year_end: null, inworld_month_end: null, inworld_day_end: null, inworld_day: 7 }, now)).toBe("up");
    expect(timeTone({ ...event, status: "happened", inworld_day_end: 6 }, now)).toBe("past");
    expect(timeTone({ ...event, status: "cancelled" }, now)).toBe("off");
    expect(timeTone(event, null)).toBe("up");
  });
  it("закреплённый месяц сравнивает периоды по месяцам, не выдумывая день", () => {
    expect(timeTone({ ...event, inworld_day: 20 }, { year: 1496, month: 6 })).toBe("on");
    expect(timeTone({ ...event, inworld_day: 20 }, now)).toBe("up");
  });
  it("календарь находит период через границу года и уважает точность", () => {
    expect(eventOccursOn({ ...event, inworld_year: 1495, inworld_month: 12, inworld_day: 30 }, now)).toBe(true);
    expect(eventOccursOn(event, { ...now, day: 25 })).toBe(false);
    expect(eventOccursOn({ inworld_year: 1496, inworld_month: 6, inworld_day: 15, date_precision: "month" }, now)).toBe(true);
    expect(eventOccursOn({ inworld_year: 1491, inworld_month: 1, inworld_day: 1, date_precision: "decade" }, now)).toBe(true);
  });
  it("пин важнее сессии; без пина — конец последней внутриигровой даты", () => {
    const sessions = [{ id: 1, session_number: 18, status: "held", inworld_year: 1496, inworld_month: 6, inworld_day: 3, inworld_day_end: 7 }] as SessionSummary[];
    expect(campaignClock({ pinned_calendar_year: 1497, pinned_calendar_month: 2 }, sessions).now).toEqual({ year: 1497, month: 2 });
    expect(campaignClock({ pinned_calendar_year: null, pinned_calendar_month: null }, sessions)).toEqual({ now, source: "по сессии №18" });
    expect(campaignClock({ pinned_calendar_year: null, pinned_calendar_month: null }, [{ ...sessions[0], status: "cancelled" }]).now).toBeNull();
  });
});
