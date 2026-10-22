import { describe, expect, it } from "vitest";
import { advanceEffects, dueOnDamage, endedLines, spellDuration, type EffectRow, type NestEffect } from "./effects";

const eff = (id: string, patch: Partial<NestEffect>): NestEffect => ({ id, name: id, casterId: 1, casterName: "Брин", ...patch });
const row = (id: number, effects: NestEffect[], repeatDue: string[] = []): EffectRow => ({ id, effects, repeatDue });

describe("длительность заклинания по тексту", () => {
  it("минуты — в раунды, долгое — до отдыха, мгновенное — нет", () => {
    expect(spellDuration("Концентрация, до 1 минуты")).toEqual({ rounds: 10 });
    expect(spellDuration("10 минут")).toEqual({ rounds: 100 });
    expect(spellDuration("1 раунд")).toEqual({ rounds: 1 });
    expect(spellDuration("Концентрация, до 6 раундов")).toEqual({ rounds: 6 });
    expect(spellDuration("Концентрация, до 1 часа")).toEqual({ until: "rest" });
    expect(spellDuration("8 часов")).toEqual({ until: "rest" });
    expect(spellDuration("Пока не рассеется")).toEqual({ until: "combat" });
    expect(spellDuration("Мгновенная")).toBeNull();
  });
});

describe("смена хода", () => {
  it("отсчёт тикает в начале хода заклинателя и кончается на нуле", () => {
    const rows = [row(2, [eff("a", { rounds: 2 }), eff("b", { rounds: 1 })])];
    const { changed, expired } = advanceEffects(rows, 3, 1);
    expect(changed.get(2)!.effects).toEqual([eff("a", { rounds: 1 })]);
    expect(expired.map((x) => x.effect.id)).toEqual(["b"]);
    // Ход не заклинателя — счёт не трогается.
    expect(advanceEffects(rows, 1, 3).changed.size).toBe(0);
  });

  it("«до конца хода цели»: взводится в начале её хода, кончается с концом", () => {
    let rows = [row(2, [eff("a", { until: "target_turn_end", casterId: 5 })])];
    const start = advanceEffects(rows, 1, 2);
    expect(start.expired).toEqual([]);
    rows = [start.changed.get(2)!];
    const end = advanceEffects(rows, 2, 3);
    expect(end.expired.map((x) => x.effect.id)).toEqual(["a"]);
  });

  it("«до конца хода наложившего» — по ходу заклинателя", () => {
    let rows = [row(2, [eff("a", { until: "caster_turn_end", casterId: 7 })])];
    rows = [advanceEffects(rows, 2, 7).changed.get(2)!];
    expect(advanceEffects(rows, 7, 2).expired.map((x) => x.effect.id)).toEqual(["a"]);
  });

  it("повтор: плашка в конце хода цели и в начале; при уроне", () => {
    const rep = (at: ("turn_end" | "turn_start" | "on_damage")[]) => ({ ability: "wis" as const, dc: 14, at });
    const rows = [row(2, [eff("end", { repeat: rep(["turn_end"]) }), eff("start", { repeat: rep(["turn_start"]) })])];
    expect(advanceEffects(rows, 2, 3).changed.get(2)!.repeatDue).toEqual(["end"]);
    expect(advanceEffects(rows, 3, 2).changed.get(2)!.repeatDue).toEqual(["start"]);
    expect(dueOnDamage([eff("d", { repeat: rep(["on_damage"]) }), eff("x", {})], [])).toEqual(["d"]);
  });

  it("кончившееся уходит и из ждущих повторов; строка «Закончилось» склеивает цели", () => {
    const rows = [row(2, [eff("a", { rounds: 1 })], ["a"]), row(4, [eff("a", { rounds: 1 })])];
    const { changed, expired } = advanceEffects(rows, 3, 1);
    expect(changed.get(2)!.repeatDue).toEqual([]);
    expect(endedLines(expired, (id) => (id === 2 ? "Тарган" : "Гуль"))).toEqual([
      { name: "a", casterName: "Брин", targets: ["Тарган", "Гуль"] },
    ]);
  });
});
