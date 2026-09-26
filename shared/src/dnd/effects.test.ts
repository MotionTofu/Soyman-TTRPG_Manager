import { describe, expect, it } from "vitest";
import { effectsLabel, resolveModifierText, type DndEffect } from "./effects";

// Кубы, где справочник пишет модификатор словами (аудит 2026-09-26): на листе
// игрок видел «2к8 + ваш модификатор…» вместо числа.
describe("модификатор в кубах — числом", () => {
  it("заклинательная характеристика", () => {
    expect(resolveModifierText("2к8 + ваш модификатор заклинательной характеристики", { spell: 3 })).toBe("2к8+3");
    expect(resolveModifierText("2к8 + ваш модификатор заклинательной характеристики", { spell: -1 })).toBe("2к8-1");
  });
  it("«Героизм»: только модификатор — число, не меньше нуля", () => {
    expect(resolveModifierText("ваш модификатор заклинательной характеристики", { spell: 4 })).toBe("4");
    expect(resolveModifierText("ваш модификатор заклинательной характеристики", { spell: -1 })).toBe("0");
  });
  it("Интеллект с минимумом +1 (пушка Артефактора)", () => {
    expect(resolveModifierText("1к8 + ваш модификатор Интеллекта (мин. +1)", { int: -1 })).toBe("1к8+1");
    expect(resolveModifierText("2к6 + ваш модификатор Интеллекта", { int: 4 })).toBe("2к6+4");
  });
  it("неизвестная характеристика — текст как есть", () => {
    const raw = "2к8 + ваш модификатор заклинательной характеристики";
    expect(resolveModifierText(raw, { int: 3 })).toBe(raw);
    expect(resolveModifierText(raw)).toBe(raw);
  });
  it("подпись строки действия берёт число", () => {
    const heal = { id: "i1", type: "heal", when: "always", dice: "2к8 + ваш модификатор заклинательной характеристики" } as DndEffect;
    expect(effectsLabel([heal], [], undefined, { spell: 3 })).toBe("2к8+3 Лечение");
  });
});
