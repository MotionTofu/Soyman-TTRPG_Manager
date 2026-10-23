import { describe, expect, it } from "vitest";
import { groupSessions } from "./sessionGroups";
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
