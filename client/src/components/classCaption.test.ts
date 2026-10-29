import { describe, expect, it } from "vitest";
import { classCaption } from "./classCaption";
import type { CompendiumEntry } from "../types";

const cls = (data: Record<string, unknown>) => ({ data } as unknown as CompendiumEntry);

describe("строка под картой класса", () => {
  it("собирает кость, характеристики и подклассы с верным склонением", () => {
    expect(classCaption(cls({ hit_die: "к10", primary_abilities: ["Сила", "Мудрость"] }), 4)).toBe("К10 · СИЛ/МДР · 4 подкласса");
    expect(classCaption(cls({ hitDie: "d6" }), 1)).toBe("К6 · 1 подкласс");
    expect(classCaption(cls({}), 11)).toBe("11 подклассов");
  });

  it("без данных подписи нет", () => {
    expect(classCaption(cls({}), 0)).toBeUndefined();
  });
});
