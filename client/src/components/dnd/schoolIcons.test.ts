import { describe, it, expect } from "vitest";
import { schoolIconSrc } from "./schoolIcons";

/**
 * Маппинг школ магии на значки. Канонические 8 — из живой базы
 * (группа «Школы магии»): переименование молча уронило бы иконку
 * в строке заклинания, поэтому список зафиксирован тестом.
 */
describe("schoolIconSrc", () => {
  const canonical: [string, string][] = [
    ["Ограждение", "/schools/Abjuration.png"],
    ["Вызов", "/schools/conjuration.png"],
    ["Прорицание", "/schools/Divination.png"],
    ["Очарование", "/schools/Enchantment.png"],
    ["Воплощение", "/schools/evocation.png"],
    ["Иллюзия", "/schools/Illusion.png"],
    ["Некромантия", "/schools/Necromancy.png"],
    ["Преобразование", "/schools/Transmutation.png"],
  ];
  it.each(canonical)("каноническое %s → %s", (name, src) => {
    expect(schoolIconSrc(name)).toBe(src);
  });

  it("английские имена тоже находятся", () => {
    expect(schoolIconSrc("abjuration")).toBe("/schools/Abjuration.png");
    expect(schoolIconSrc("Evocation")).toBe("/schools/evocation.png");
  });

  it("не-школы значка не получают", () => {
    expect(schoolIconSrc("Метка охотника")).toBeNull();
    expect(schoolIconSrc("Отравленный")).toBeNull();
    expect(schoolIconSrc("")).toBeNull();
    expect(schoolIconSrc(null)).toBeNull();
    expect(schoolIconSrc(undefined)).toBeNull();
  });
});
