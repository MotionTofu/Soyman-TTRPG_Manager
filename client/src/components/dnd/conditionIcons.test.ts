import { describe, it, expect } from "vitest";
import { conditionIconSrc } from "./conditionIcons";

/**
 * Маппинг имён состояний на значки. Канонические 15 — из живой базы
 * (группа «Состояния»): переименование или потеря любого из них молча
 * уронила бы иконку на карте, поэтому список зафиксирован тестом.
 */
describe("conditionIconSrc", () => {
  const canonical: [string, string][] = [
    ["Ослеплённый", "/conditions/blinded.webp"],
    ["Очарованный", "/conditions/charmed.webp"],
    ["Оглохший", "/conditions/deafened.webp"],
    ["Испуганный", "/conditions/frightened.webp"],
    ["Недееспособный", "/conditions/incapacitated.webp"],
    ["Невидимый", "/conditions/invisible.webp"],
    ["Парализованный", "/conditions/paralyzed.webp"],
    ["Отравленный", "/conditions/poisoned.webp"],
    ["Лежащий ничком", "/conditions/prone.webp"],
    ["Опутанный", "/conditions/restrained.webp"],
    ["Ошеломлённый", "/conditions/stunned.webp"],
    ["Бессознательный", "/conditions/unconscious.webp"],
    ["Истощённый", "/conditions/exhaustion.webp"],
    ["Схваченный", "/conditions/grappled.webp"],
    ["Окаменевший", "/conditions/petrified.webp"],
  ];
  it.each(canonical)("каноническое %s → %s", (name, src) => {
    expect(conditionIconSrc(name)).toBe(src);
  });

  it("варианты из книг и краткие формы тоже находятся", () => {
    expect(conditionIconSrc("Сбит с ног")).toBe("/conditions/prone.webp");
    expect(conditionIconSrc("Опрокинут")).toBe("/conditions/prone.webp");
    expect(conditionIconSrc("Оглушённый")).toBe("/conditions/stunned.webp");
    expect(conditionIconSrc("Оглушён")).toBe("/conditions/stunned.webp");
    expect(conditionIconSrc("Парализован")).toBe("/conditions/paralyzed.webp");
    expect(conditionIconSrc("Испугана")).toBe("/conditions/frightened.webp");
    expect(conditionIconSrc("Невидимость")).toBe("/conditions/invisible.webp");
    expect(conditionIconSrc("Истощение")).toBe("/conditions/exhaustion.webp");
    expect(conditionIconSrc("blinded")).toBe("/conditions/blinded.webp");
  });

  it("не-состояния значка не получают", () => {
    expect(conditionIconSrc("Метка охотника")).toBeNull();
    expect(conditionIconSrc("есть")).toBeNull();
    expect(conditionIconSrc("Огненный")).toBeNull();
    expect(conditionIconSrc("")).toBeNull();
    expect(conditionIconSrc(null)).toBeNull();
    expect(conditionIconSrc(undefined)).toBeNull();
  });
});
