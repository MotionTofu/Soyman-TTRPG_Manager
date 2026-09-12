import { describe, it, expect } from "vitest";
import { schoolIconSrc } from "./schoolIcons";

/**
 * Маппинг школ магии на значки. Канонические 8 — из живой базы
 * (группа «Школы магии»): переименование молча уронило бы иконку
 * в строке заклинания, поэтому список зафиксирован тестом.
 */
describe("schoolIconSrc", () => {
  const canonical: [string, string][] = [
    ["Ограждение", "/schools/abjuration.webp"],
    ["Вызов", "/schools/conjuration.webp"],
    ["Прорицание", "/schools/divination.webp"],
    ["Очарование", "/schools/enchantment.webp"],
    ["Воплощение", "/schools/evocation.webp"],
    ["Иллюзия", "/schools/illusion.webp"],
    ["Некромантия", "/schools/necromancy.webp"],
    ["Преобразование", "/schools/transmutation.webp"],
  ];
  it.each(canonical)("каноническое %s → %s", (name, src) => {
    expect(schoolIconSrc(name)).toBe(src);
  });

  it("английские имена тоже находятся", () => {
    expect(schoolIconSrc("abjuration")).toBe("/schools/abjuration.webp");
    expect(schoolIconSrc("Evocation")).toBe("/schools/evocation.webp");
  });

  it("не-школы значка не получают", () => {
    expect(schoolIconSrc("Метка охотника")).toBeNull();
    expect(schoolIconSrc("Отравленный")).toBeNull();
    expect(schoolIconSrc("")).toBeNull();
    expect(schoolIconSrc(null)).toBeNull();
    expect(schoolIconSrc(undefined)).toBeNull();
  });
});
