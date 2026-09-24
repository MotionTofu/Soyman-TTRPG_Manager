import { describe, it, expect, vi } from "vitest";
import { startingSetsFrom } from "./dndEquipment";
import type { CompendiumEntry } from "../../types";

// Слой данных тянет клиент API с localStorage — разбору наборов он не нужен.
vi.mock("../../data/imperative", () => ({ readEntity: vi.fn() }));

const entry = (data: Record<string, unknown>) => ({ id: 1, name: "Воин", data }) as unknown as CompendiumEntry;

describe("startingSetsFrom", () => {
  it("reads the gold-only C option (Fighter 2024)", () => {
    const sets = startingSetsFrom(
      entry({ equipment_a_items: [{ entryId: 5, name: "Кольчуга", qty: 1 }], equipment_a_gold: "4", equipment_b_gold: "11", equipment_c_gold: "155" }),
      "Воин"
    );
    expect(sets.map((s) => s.letter)).toEqual(["A", "B", "C"]);
    expect(sets[2]).toMatchObject({ gold: "155", items: [], choices: [] });
  });
  it("parses choices inside a set and drops malformed ones", () => {
    const [a] = startingSetsFrom(
      entry({
        equipment_a_gold: "19",
        equipment_a_choices: [{ count: 1, group: "Музыкальный инструмент" }, { group: "Игровой набор", fromProficiency: true }, { count: 2 }, null],
      }),
      "Бард"
    );
    expect(a.choices).toEqual([
      { count: 1, group: "Музыкальный инструмент", fromProficiency: false },
      { count: 1, group: "Игровой набор", fromProficiency: true },
    ]);
  });
});
