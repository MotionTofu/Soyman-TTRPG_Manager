import { describe, it, expect } from "vitest";
import { conditionIconSrc } from "./conditionIcons";

/**
 * Маппинг имён состояний на значки. Канонические 15 — из живой базы
 * (группа «Состояния»): переименование или потеря любого из них молча
 * уронила бы иконку на карте, поэтому список зафиксирован тестом.
 */
describe("conditionIconSrc", () => {
  const canonical: [string, string][] = [
    ["Ослеплённый", "/conditions/blinded.png"],
    ["Очарованный", "/conditions/charmed.png"],
    ["Оглохший", "/conditions/deafened.png"],
    ["Испуганный", "/conditions/frightened.png"],
    ["Недееспособный", "/conditions/Incapacitated.png"],
    ["Невидимый", "/conditions/Invisible.png"],
    ["Парализованный", "/conditions/Paralyzed.png"],
    ["Отравленный", "/conditions/posioned.png"],
    ["Лежащий ничком", "/conditions/prone.png"],
    ["Опутанный", "/conditions/restrained.png"],
    ["Ошеломлённый", "/conditions/stunned.png"],
    ["Бессознательный", "/conditions/unconscious.png"],
    ["Истощённый", "/conditions/exhaustion.png"],
    ["Схваченный", "/conditions/grappled.png"],
    ["Окаменевший", "/conditions/petrified.png"],
  ];
  it.each(canonical)("каноническое %s → %s", (name, src) => {
    expect(conditionIconSrc(name)).toBe(src);
  });

  it("варианты из книг и краткие формы тоже находятся", () => {
    expect(conditionIconSrc("Сбит с ног")).toBe("/conditions/prone.png");
    expect(conditionIconSrc("Опрокинут")).toBe("/conditions/prone.png");
    expect(conditionIconSrc("Оглушённый")).toBe("/conditions/stunned.png");
    expect(conditionIconSrc("Оглушён")).toBe("/conditions/stunned.png");
    expect(conditionIconSrc("Парализован")).toBe("/conditions/Paralyzed.png");
    expect(conditionIconSrc("Испугана")).toBe("/conditions/frightened.png");
    expect(conditionIconSrc("Невидимость")).toBe("/conditions/Invisible.png");
    expect(conditionIconSrc("Истощение")).toBe("/conditions/exhaustion.png");
    expect(conditionIconSrc("blinded")).toBe("/conditions/blinded.png");
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
