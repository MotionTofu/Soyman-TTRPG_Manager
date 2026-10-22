import { describe, expect, it } from "vitest";
import { concentrationDc, startOfTurn } from "./nestState";

describe("начало хода (Q26)", () => {
  it("возвращает реакцию, легендарные очки и замки", () => {
    const { state, changed } = startOfTurn({ reactionSpent: true, legendaryUsed: 2, legendaryLocked: ["Наскок"], note: "x" });
    expect(changed).toBe(true);
    expect(state).toEqual({ reactionSpent: false, legendaryUsed: 0, legendaryLocked: [], note: "x" });
  });

  it("не готовая перезарядка бросает к6, готовая не трогается", () => {
    const { state } = startOfTurn({
      recharge: { Дыхание: { ready: false, min: 5 }, Рёв: { ready: true, min: 6 } },
    });
    const breath = state.recharge!["Дыхание"];
    expect(breath.roll).toBeGreaterThanOrEqual(1);
    expect(breath.roll).toBeLessThanOrEqual(6);
    expect(breath.ready).toBe(breath.roll! >= 5);
    expect(state.recharge!["Рёв"]).toEqual({ ready: true, min: 6 });
  });

  it("нечего возвращать — правки нет", () => {
    expect(startOfTurn({ note: "x" }).changed).toBe(false);
  });
});

describe("СЛ концентрации", () => {
  it("10, половина урона или 30", () => {
    expect(concentrationDc(7)).toBe(10);
    expect(concentrationDc(31)).toBe(15);
    expect(concentrationDc(100)).toBe(30);
  });
});
