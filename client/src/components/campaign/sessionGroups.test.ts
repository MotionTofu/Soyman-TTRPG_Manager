import { describe, expect, it } from "vitest";
import { daysUntilLabel, groupSessions, hasOutcome, heldTails, passportDone } from "./sessionGroups";
import type { SessionSummary } from "../../types";

const s = (id: number, date: string, status: SessionSummary["status"]) => ({ id, date, status }) as SessionSummary;
const list = [
  s(1, "2026-09-26", "held"),
  s(2, "2026-10-03", "held"),
  s(3, "2026-10-17", "held"),
  s(4, "2026-10-20", "planned"), // прошла, не разобрана
  s(5, "2026-10-23", "planned"), // сегодня — ещё впереди
  s(6, "2026-11-14", "planned"),
];

describe("groupSessions", () => {
  it("Мастер: прошедшая неразобранная — в «Ждут разбора», сегодняшняя — впереди, сыгранные по месяцам от последнего", () => {
    const g = groupSessions(list, "2026-10-23", true);
    expect(g.overdue.map((x) => x.id)).toEqual([4]);
    expect(g.planned.map((x) => x.id)).toEqual([5, 6]);
    expect(g.months.map((m) => [m.title, m.sessions.map((x) => x.id)])).toEqual([
      ["Октябрь 2026", [3, 2]],
      ["Сентябрь 2026", [1]],
    ]);
  });

  it("игрок: разбирать нечего — прошедшая у него среди сыгранных", () => {
    const g = groupSessions(list, "2026-10-23", false);
    expect(g.overdue).toEqual([]);
    expect(g.months[0].sessions.map((x) => x.id)).toEqual([4, 3, 2]);
  });
});

describe("хвосты строки", () => {
  const held = (attended_count: number, attendance_total: number, unpaid_count = 0) =>
    ({ id: 1, date: "2026-10-17", status: "held", attended_count, attendance_total, unpaid_count }) as SessionSummary;

  it("0 из N — не разобрана, а не неявка; «3 из 4» — только частичная неявка", () => {
    expect(heldTails(held(0, 4))).toEqual({ unreviewed: true, attendance: null, unpaid: 0 });
    expect(heldTails(held(3, 4, 2))).toEqual({ unreviewed: false, attendance: "3 из 4", unpaid: 2 });
    expect(heldTails(held(4, 4))).toEqual({ unreviewed: false, attendance: null, unpaid: 0 });
    expect(heldTails(held(0, 0)).unreviewed).toBe(false);
  });

  it("подготовка, итог и «через N дн.»", () => {
    expect(passportDone({ idea_notes: "Бал", questions: "  ", exit_state: "Город горит" })).toEqual({ done: 2, total: 4 });
    expect(hasOutcome({ goal: " " })).toBe(false);
    expect(hasOutcome({ world: "Порт закрыт" })).toBe(true);
    expect([daysUntilLabel("2026-10-23", "2026-10-23"), daysUntilLabel("2026-10-24", "2026-10-23"), daysUntilLabel("2026-10-31", "2026-10-23")]).toEqual([
      "сегодня",
      "завтра",
      "через 8 дн.",
    ]);
  });
});
