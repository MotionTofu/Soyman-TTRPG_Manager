import { describe, it, expect } from "vitest";
import { normalizeDndCharacter, emptyDndCharacter } from "./normalize";
import { resolveSkillOriginal } from "./skillCatalog";

/**
 * Первые тесты клиентских правил D&D в этом проекте.
 *
 * Нормализация — барьер совместимости форматов листа: она чинит при чтении то,
 * что писали прежние версии. Пока она жила внутри React-файла на 11 751
 * строку, проверить её было нечем — приходилось открывать старый лист в
 * приложении и смотреть глазами. Каждый случай ниже соответствует одной
 * миграции, и написан от входа: «вот как лист выглядел раньше — вот что
 * должно получиться».
 */

describe("нормализация листа не теряет данные старых форматов", () => {
  it("мусор на входе даёт пустой лист, а не падение", () => {
    for (const raw of [null, undefined, 42, "лист", [], true]) {
      expect(() => normalizeDndCharacter(raw)).not.toThrow();
    }
    expect(normalizeDndCharacter(null)).toEqual(emptyDndCharacter());
    expect(normalizeDndCharacter("не объект")).toEqual(emptyDndCharacter());
  });

  it("класс строкой превращается в строку класса", () => {
    const sheet = normalizeDndCharacter({ classAndLevel: "Друид 5" });
    expect(sheet.classes.length).toBe(1);
    // Уровень из строки НЕ разбирается: вся строка кладётся в имя класса, а
    // уровень становится 1. Так это работало и до переноса; зафиксировано
    // как есть, потому что смена поведения меняла бы бонус мастерства у
    // старых листов. На живой базе таких листов ноль (проверено 2026-09-10),
    // но это дефект — см. «Находки» в docs/dnd-derive-revision.md.
    expect(sheet.classes[0].className).toBe("Друид 5");
    expect(sheet.classes[0].level).toBe(1);
  });

  it("булево владение навыком становится 0 или 1", () => {
    const athletics = resolveSkillOriginal("Атлетика")!;
    const sheet = normalizeDndCharacter({ skillProfs: { [athletics]: true } });
    expect(sheet.skillProfs[athletics]).toBe(1);

    const off = normalizeDndCharacter({ skillProfs: { [athletics]: false } });
    expect(off.skillProfs[athletics]).toBe(0);
  });

  it("русское имя навыка сводится к английскому ключу", () => {
    const sheet = normalizeDndCharacter({ skillProfs: { "Атлетика": 2 } });
    const key = resolveSkillOriginal("Атлетика")!;
    expect(key).not.toBe("Атлетика");
    expect(sheet.skillProfs[key]).toBe(2);
  });

  it("два имени, сведённые в один ключ, дают большее владение", () => {
    // «Аркана» и «Магия» — одно и то же на разных версиях листа. Побеждает
    // не последнее прочитанное, а большее: понижать владение молча нельзя.
    const key = resolveSkillOriginal("Аркана");
    if (!key) return;
    const sheet = normalizeDndCharacter({ skillProfs: { "Аркана": 1, [key]: 2 } });
    expect(sheet.skillProfs[key]).toBe(2);
  });

  it("несводимое имя навыка сохраняется, а не теряется", () => {
    const sheet = normalizeDndCharacter({ skillProfs: { "Жонглирование": 1 } });
    expect(sheet.skillProfs["Жонглирование"]).toBe(1);
  });

  it("свободный текст снаряжения становится позициями", () => {
    const sheet = normalizeDndCharacter({
      equipment: "Верёвка 15 м\n\nФакел\n  Рацион  ",
    });
    expect(sheet.equipmentSections.length).toBe(1);
    expect(sheet.equipmentSections[0].name).toBe("Общее");
    expect(sheet.equipmentSections[0].items.map((i) => i.name)).toEqual([
      "Верёвка 15 м",
      "Факел",
      "Рацион",
    ]);
    // Без id ключи списка снова свалятся на индекс.
    expect(sheet.equipmentSections[0].items.every((i) => !!i.id)).toBe(true);
  });

  it("строкам снаряжения без id этот id добивается", () => {
    const sheet = normalizeDndCharacter({
      equipmentSections: [{ name: "Пояс", items: [{ name: "Зелье", qty: "2", weight: "", notes: "" }] }],
    });
    expect(sheet.equipmentSections[0].items[0].id).toBeTruthy();
    expect(sheet.equipmentSections[0].items[0].name).toBe("Зелье");
  });

  it("вид и предыстория строками переезжают в свои поля", () => {
    const sheet = normalizeDndCharacter({ race: "Человек", background: "Отшельник" });
    expect(sheet.raceName).toBe("Человек");
    expect(sheet.backgroundName).toBe("Отшельник");
  });

  it("истощение зажимается в 0..6", () => {
    expect(normalizeDndCharacter({ exhaustion: 99 }).exhaustion).toBe(6);
    expect(normalizeDndCharacter({ exhaustion: -3 }).exhaustion).toBe(0);
    expect(normalizeDndCharacter({ exhaustion: "три" }).exhaustion).toBe(0);
    expect(normalizeDndCharacter({ exhaustion: 4 }).exhaustion).toBe(4);
  });

  it("скорость строкой переезжает в структуру скоростей", () => {
    expect(normalizeDndCharacter({ speed: "30 фт." }).speeds.walk).toBe(30);
    // Строка, называющая вид передвижения, — не пешая скорость: «полёт 60»
    // в `speeds.walk` превратился бы в ложь.
    expect(normalizeDndCharacter({ speed: "полёт 60 фт." }).speeds.walk).toBe(null);
  });

  it("поля, которых не было в старых листах, не приходят как undefined", () => {
    // Спред кладёт undefined поверх умолчания, и дорожка костей падала на
    // первом же чтении.
    const sheet = normalizeDndCharacter({ characterName: "Арья" });
    expect(sheet.hitDiceUsed).toEqual({});
    expect(typeof sheet.concentration).toBe("string");
    expect(Array.isArray(sheet.pinnedActions)).toBe(true);
    expect(Array.isArray(sheet.companions)).toBe(true);
  });

  it("массивы, пришедшие не массивами, становятся массивами", () => {
    const sheet = normalizeDndCharacter({
      damageResistances: "огонь",
      conditions: null,
      feats: 7,
    });
    expect(sheet.damageResistances).toEqual([]);
    expect(sheet.conditions).toEqual([]);
    expect(Array.isArray(sheet.feats)).toBe(true);
  });

  it("нормализация идемпотентна", () => {
    // Лист, прочитанный дважды, не должен меняться на втором проходе: иначе
    // сохранение после открытия молча правит данные.
    const once = normalizeDndCharacter({
      classAndLevel: "Друид 5",
      race: "Человек",
      equipment: "Факел",
      skillProfs: { "Атлетика": true },
      speed: "30 фт.",
    });
    const twice = normalizeDndCharacter(once);
    // id строк снаряжения генерируются, но у уже проставленных сохраняются.
    expect(twice).toEqual(once);
  });
});

describe("инициатива: строка-модификатор становится числом-броском", () => {
  // Поле сменило и тип, и смысл 2026-09-10: было строкой с вписанным руками
  // модификатором, стало числом с брошенным значением. Старые листы обязаны
  // открыться, а не свалиться на первом же чтении.
  it("строка, которая читается числом, переносится", () => {
    expect(normalizeDndCharacter({ initiative: "17" }).initiative).toBe(17);
    expect(normalizeDndCharacter({ initiative: "+2" }).initiative).toBe(2);
    expect(normalizeDndCharacter({ initiative: "-1" }).initiative).toBe(-1);
    // Ноль — законное число, а не «пусто».
    expect(normalizeDndCharacter({ initiative: "0" }).initiative).toBe(0);
  });

  it("пустая строка и не-число дают «броска нет»", () => {
    expect(normalizeDndCharacter({ initiative: "" }).initiative).toBe(null);
    expect(normalizeDndCharacter({ initiative: "  " }).initiative).toBe(null);
    // «+2 (Ловкость)» — не число: выдумывать за Мастера, что он имел в виду,
    // модуль не должен.
    expect(normalizeDndCharacter({ initiative: "+2 (Ловкость)" }).initiative).toBe(null);
  });

  it("лист без поля открывается", () => {
    expect(normalizeDndCharacter({}).initiative).toBe(null);
    expect(normalizeDndCharacter({ initiative: null }).initiative).toBe(null);
  });

  it("ручная поправка к бонусу — строка и по умолчанию пустая", () => {
    expect(normalizeDndCharacter({}).initiativeMisc).toBe("");
    expect(normalizeDndCharacter({ initiativeMisc: "+1" }).initiativeMisc).toBe("+1");
    // Число вместо строки пришло бы из чужого формата — не роняем разбор.
    expect(normalizeDndCharacter({ initiativeMisc: 3 }).initiativeMisc).toBe("");
  });
});
