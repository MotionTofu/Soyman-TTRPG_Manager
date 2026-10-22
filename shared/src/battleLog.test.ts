import { describe, expect, it } from "vitest";
import { battleStats, describeChanges, diffValues, undoChanges, type LogChange, type LogTarget } from "./battleLog";

const ghoul: LogTarget = { t: "row", id: 2, name: "Упырь", party: false };
const row = (hp: number, extra: Record<string, unknown> = {}) => ({
  current_hp: hp,
  temp_hp: 0,
  max_hp: 22,
  dead: false,
  conditions: [] as string[],
  state: {},
  ...extra,
});

describe("лог боя", () => {
  it("отменяет урон разницей и не трогает позднего", () => {
    const first: LogChange[] = [{ target: ghoul, ops: diffValues(row(22), row(10)) }];
    expect(describeChanges(first, "Урон").text).toBe("Упырь −12 (22 → 10)");
    // Потом ещё 5 — отмена первого удара возвращает 12 к текущим 5.
    const res = undoChanges(first, () => row(5));
    expect(res.conflict).toBeNull();
    expect(res.next.get("row:2")!.view.current_hp).toBe(17);
  });

  it("эффект: снимает свой, отказывает, если его уже нет", () => {
    const porcha = { id: "e1", name: "Порча", casterName: "Брин", rounds: 10, casterId: 1 };
    const before = row(22);
    const after = row(22, { state: { effects: [porcha] } });
    const changes: LogChange[] = [{ target: ghoul, ops: diffValues(before, after) }];
    expect(describeChanges(changes, "").text).toBe("Брин: «Порча» → Упырь · 10 р.");
    const ok = undoChanges(changes, () => row(22, { state: { effects: [{ ...porcha }, { id: "e2", name: "Щит" }] } }));
    expect((ok.next.get("row:2")!.view.state as { effects: unknown[] }).effects).toEqual([{ id: "e2", name: "Щит" }]);
    expect(undoChanges(changes, () => row(22)).conflict).toBe("«Порча» уже снято — Упырь");
  });

  it("ход: заголовок, отсчёт и возврат хода", () => {
    const session: LogTarget = { t: "session", round: 3, turnName: "Брин" };
    const tick = { id: "e1", name: "Порча", rounds: 9 };
    const changes: LogChange[] = [
      { target: session, ops: diffValues({ round: 2, turn: 7 }, { round: 3, turn: 8 }) },
      { target: ghoul, ops: diffValues(row(10, { state: { effects: [tick] } }), row(10, { state: { effects: [{ ...tick, rounds: 8 }] } })) },
    ];
    const d = describeChanges(changes, "");
    expect(d).toMatchObject({ kind: "turn", round: 3, text: "Раунд 3 · ход Брин", sub: "Порча у Упырь: 9 → 8 р." });
    const res = undoChanges(changes, (t) => (t.t === "session" ? { round: 3, turn: 8 } : row(10, { state: { effects: [{ ...tick, rounds: 8 }] } })));
    expect(res.next.get("session")!.view).toEqual({ round: 2, turn: 7 });
  });

  it("итоги: урон по сторонам и повергнутые", () => {
    const tarRow: LogTarget = { t: "sheet", cid: 5, name: "Тарган", party: true };
    const lines = [
      { undone: false, changes: [{ target: ghoul, ops: diffValues(row(22), row(0, { dead: true })) }] },
      { undone: false, changes: [{ target: tarRow, ops: diffValues({ hitPointsCurrent: "52" }, { hitPointsCurrent: "45" }) }] },
      { undone: true, changes: [{ target: tarRow, ops: diffValues({ hitPointsCurrent: "45" }, { hitPointsCurrent: "40" }) }] },
    ];
    expect(battleStats(lines)).toEqual({ dealt: 22, taken: 7, defeated: ["Упырь"] });
  });
});
