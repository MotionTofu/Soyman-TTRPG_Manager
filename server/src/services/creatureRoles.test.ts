import { describe, it, expect } from "vitest";
import { suggestCombatRoles } from "./creatureRoles";

function sb(doc: Record<string, unknown>) {
  return JSON.stringify({ name: "Тест", actions: [], bonusActions: [], traits: [], ...doc });
}

const melee = (name: string, damage: string) => ({
  name,
  description: `Бросок рукопашной атаки: +4. Попадание: ${damage}.`,
});

describe("suggestCombatRoles", () => {
  it("brute gets melee and high damage", () => {
    const r = suggestCombatRoles(
      sb({
        challenge: { rating: "2" },
        hitPoints: { diceCount: 4, dieSize: 10, bonus: 8 },
        actions: [
          { name: "Мультиатака", description: "Совершает две атаки топором." },
          melee("Топор", "11 (2к8 + 2) рубящего урона"),
        ],
      })
    );
    // DPR 22 > топ 20 → Высокий урон; приоритет выше Ближнего боя
    expect(r).toEqual(["Высокий урон", "Ближний бой"]);
  });
  it("archer gets ranged only", () => {
    const r = suggestCombatRoles(
      sb({
        challenge: { rating: "1" },
        actions: [{ name: "Лук", description: "Бросок дальнобойной атаки: +4, дистанция 60/120. Попадание: 5 (1к8 + 1) урона." }],
      })
    );
    expect(r).toEqual(["Дальний бой"]);
  });
  it("caster gets spellcaster", () => {
    const r = suggestCombatRoles(
      sb({
        challenge: { rating: "4" },
        spellcasting: { enabled: true, ability: "int", slots: [], spells: [] },
        actions: [{ name: "Огненный шар", description: "Спасбросок Ловкости: Сл 15. Провал: 21 (6к6) урона огнём." }],
      })
    );
    expect(r).toContain("Заклинатель");
  });
  it("flyer gets mobile", () => {
    const r = suggestCombatRoles(
      sb({
        challenge: { rating: "1" },
        speed: { walk: 30, fly: 60, swim: null, climb: null, burrow: null, hover: false },
        actions: [melee("Когти", "4 (1к4 + 2) урона")],
      })
    );
    expect(r).toContain("Мобильный");
    expect(r).toContain("Ближний бой");
  });
  it("resistant gets tanky", () => {
    const r = suggestCombatRoles(
      sb({
        challenge: { rating: "5" },
        damageResistances: ["огонь", "холод"],
        damageImmunities: ["яд"],
        conditionImmunities: ["отравленный"],
        actions: [melee("Удар", "9 (1к12 + 3) урона")],
      })
    );
    expect(r).toContain("Танковый");
  });
  it("controller gets control", () => {
    const r = suggestCombatRoles(
      sb({
        challenge: { rating: "3" },
        actions: [
          { name: "Вой", description: "Спасбросок Мудрости: Сл 13. Провал: цель Испугана до конца следующего хода." },
          melee("Когти", "6 (1к6 + 3) урона"),
        ],
      })
    );
    expect(r).toContain("Контроль");
  });
  it("returns empty for invalid json", () => {
    expect(suggestCombatRoles("garbage")).toEqual([]);
  });
});
