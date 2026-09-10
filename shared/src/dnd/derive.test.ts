import { describe, it, expect } from "vitest";
import { deriveSheet, proficiencyBonusForLevel } from "./derive";
import { emptyDndCharacter } from "./normalize";
import type { DndCharacterData, DndClassEntry, DndEquipmentItem, DndFeature } from "./types";
import { resolveSkillOriginal } from "./skillCatalog";

/**
 * Персонажи здесь синтетические и по одному на случай: в тесте должно быть
 * видно, что подано на вход и почему ожидается именно это число. Живой лист —
 * 107 полей, из которых на результат влияют три, и через год никто не
 * вспомнит, откуда там 17.
 */
function character(over: Partial<DndCharacterData> = {}): DndCharacterData {
  return { ...emptyDndCharacter(), ...over };
}

function cls(over: Partial<DndClassEntry> = {}): DndClassEntry {
  return {
    classId: null,
    className: "Друид",
    subclassId: null,
    subclassName: "",
    level: 1,
    skillChoiceOptions: [],
    skillChoiceCount: 0,
    spellcastingAbility: "",
    ...over,
  };
}

function item(over: Partial<DndEquipmentItem> = {}): DndEquipmentItem {
  return { id: "x", name: "", qty: "", weight: "", notes: "", equipped: true, ...over } as DndEquipmentItem;
}

function feature(name: string): DndFeature {
  return { name, description: "" } as DndFeature;
}

/** Слагаемые обязаны складываться в само число — иначе разбор врёт. */
function partsAddUp(d: { value: number; parts: { value: number }[] }) {
  expect(d.parts.reduce((n, p) => n + p.value, 0)).toBe(d.value);
}

describe("бонус мастерства", () => {
  it("растёт по таблице и упирается в +6", () => {
    const table: [number, number][] = [
      [1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4],
      [13, 5], [16, 5], [17, 6], [20, 6], [30, 6],
    ];
    for (const [level, expected] of table) {
      expect(proficiencyBonusForLevel(level), `уровень ${level}`).toBe(expected);
    }
  });

  it("пустой список классов — это всё-таки первый уровень", () => {
    expect(proficiencyBonusForLevel(0)).toBe(2);
    expect(deriveSheet(character()).proficiencyBonus.value).toBe(2);
  });

  it("у мультикласса считается суммарный уровень", () => {
    const sheet = deriveSheet(
      character({ classes: [cls({ className: "Воин", level: 3 }), cls({ className: "Волшебник", level: 2 })] })
    );
    expect(sheet.level.value).toBe(5);
    expect(sheet.proficiencyBonus.value).toBe(3);
  });
});

describe("характеристики, спасброски и навыки", () => {
  it("модификатор считается по значению", () => {
    const sheet = deriveSheet(character({ abilities: { str: 8, dex: 14, con: 15, int: 10, wis: 18, cha: 3 } }));
    expect(sheet.abilityModifiers.str.value).toBe(-1);
    expect(sheet.abilityModifiers.dex.value).toBe(2);
    expect(sheet.abilityModifiers.con.value).toBe(2);
    expect(sheet.abilityModifiers.int.value).toBe(0);
    expect(sheet.abilityModifiers.wis.value).toBe(4);
    expect(sheet.abilityModifiers.cha.value).toBe(-4);
  });

  it("владение спасброском добавляет бонус мастерства", () => {
    const c = character({
      classes: [cls({ level: 5 })],
      abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
      savingThrowProfs: { str: false, dex: false, con: true, int: false, wis: false, cha: false },
    });
    const sheet = deriveSheet(c);
    expect(sheet.saves.con.value).toBe(2 + 3);
    expect(sheet.saves.str.value).toBe(0);
    partsAddUp(sheet.saves.con);
  });

  it("экспертиза удваивает бонус мастерства, владение — нет", () => {
    const athletics = resolveSkillOriginal("Атлетика")!;
    const c = character({
      classes: [cls({ level: 5 })],
      abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      skillProfs: { [athletics]: 2 },
    });
    expect(deriveSheet(c).skills[athletics].value).toBe(3 + 6);

    const c1 = { ...c, skillProfs: { [athletics]: 1 as const } };
    expect(deriveSheet(c1).skills[athletics].value).toBe(3 + 3);

    const c0 = { ...c, skillProfs: {} };
    expect(deriveSheet(c0).skills[athletics].value).toBe(3);
  });

  it("истощение снимает по 2 с любого броска к20", () => {
    const athletics = resolveSkillOriginal("Атлетика")!;
    const c = character({
      classes: [cls({ level: 5 })],
      abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
      skillProfs: { [athletics]: 1 },
      savingThrowProfs: { str: false, dex: false, con: true, int: false, wis: false, cha: false },
      exhaustion: 2,
    });
    const sheet = deriveSheet(c);
    expect(sheet.exhaustionPenalty.value).toBe(4);
    expect(sheet.skills[athletics].value).toBe(3 + 3 - 4);
    expect(sheet.saves.con.value).toBe(2 + 3 - 4);
    // А на КЗ истощение не влияет: это не бросок к20.
    expect(sheet.armorClass.value).toBe(10);
  });
});

describe("класс защиты", () => {
  it("без доспеха — 10 плюс Ловкость", () => {
    const sheet = deriveSheet(character({ abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 } }));
    expect(sheet.armorClass.value).toBe(13);
  });

  it("доспех заменяет базу и режет Ловкость своим пределом", () => {
    const c = character({
      abilities: { str: 10, dex: 18, con: 10, int: 10, wis: 10, cha: 10 },
      equipmentSections: [
        { name: "Общее", items: [item({ name: "Кольчуга", armorType: "Средний", ac: "14", maxDexBonus: "2" })] },
      ],
    });
    expect(deriveSheet(c).armorClass.value).toBe(14 + 2);
  });

  it("щит идёт плюсом, а не в базу", () => {
    // Прежний расчёт брал «2» щита за базовое КЗ, и персонаж со щитом без
    // доспеха получал 2 + Ловкость вместо 12 + Ловкость.
    const c = character({
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      equipmentSections: [{ name: "Общее", items: [item({ name: "Щит", armorType: "Щит", ac: "2" })] }],
    });
    expect(deriveSheet(c).armorClass.value).toBe(10 + 2 + 2);
  });

  it("защита без доспехов монаха добавляет Мудрость и гасится щитом", () => {
    const base = {
      abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 16, cha: 10 },
      classes: [cls({ className: "Монах", level: 5 })],
      classFeatures: [feature("Защита без доспехов")],
    } as Partial<DndCharacterData>;

    expect(deriveSheet(character(base)).armorClass.value).toBe(10 + 2 + 3);

    const withShield = character({
      ...base,
      equipmentSections: [{ name: "Общее", items: [item({ name: "Щит", armorType: "Щит", ac: "2" })] }],
    });
    // Монаху щит умение гасит: 10 + Ловкость + щит, без Мудрости.
    expect(deriveSheet(withShield).armorClass.value).toBe(10 + 2 + 2);
  });

  it("варвару щит умение не гасит", () => {
    const c = character({
      abilities: { str: 10, dex: 14, con: 16, int: 10, wis: 10, cha: 10 },
      classes: [cls({ className: "Варвар", level: 5 })],
      classFeatures: [feature("Защита без доспехов")],
      equipmentSections: [{ name: "Общее", items: [item({ name: "Щит", armorType: "Щит", ac: "2" })] }],
    });
    expect(deriveSheet(c).armorClass.value).toBe(10 + 2 + 2 + 3);
  });

  it("сохранённое поле armorClass не читается", () => {
    // Оно свободный текст, его пишет импорт, и оно устаревает молча.
    const c = character({ armorClass: "99", abilities: { str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10 } });
    expect(deriveSheet(c).armorClass.value).toBe(11);
  });
});

describe("максимум хитов", () => {
  it("складывается из сохранённых слагаемых", () => {
    // Друид 5: кость к8, база 8 + 4×5 = 28 дайсовой части, Телосложение +2.
    const c = character({
      classes: [cls({ className: "Друид", level: 5 })],
      abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
      hpLump: 8,
      hpRolls: [5, 6, 4, 7],
      hitPointMax: "0",
    });
    const hp = deriveSheet(c).maxHitPoints;
    expect(hp.value).toBe(8 + 22 + 2 * 5);
    expect(hp.stale).toBeUndefined();
    partsAddUp(hp);
  });

  it("Телосложение считается от уровня ПЕРСОНАЖА, а не качаемого класса", () => {
    // Регрессия «минус шестнадцать хитов» (найдено 09.09): у мультикласса
    // Телосложение и «прочее за уровень» брались от уровня одной строки, и
    // ап второй строки давал 89 → 73.
    const c = character({
      classes: [cls({ className: "Воин", level: 5 }), cls({ className: "Волшебник", level: 3 })],
      abilities: { str: 10, dex: 10, con: 16, int: 10, wis: 10, cha: 10 },
      hpLump: 40,
      hpRolls: [],
    });
    const hp = deriveSheet(c).maxHitPoints;
    // 8 уровней × +3 Телосложения, а не 5 и не 3.
    expect(hp.value).toBe(40 + 3 * 8);
    expect(hp.parts.some((p) => p.label.includes("×8"))).toBe(true);
  });

  it("черта «Крепкий» даёт по 2 за каждый уровень", () => {
    const c = character({
      classes: [cls({ level: 4 })],
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      hpLump: 20,
      hpRolls: [],
      feats: [feature("Крепкий")],
    });
    expect(deriveSheet(c).maxHitPoints.value).toBe(20 + 2 * 4);
  });

  it("пересчёт устойчив: одни и те же слагаемые дают одно и то же число", () => {
    // Регрессия «81 → 116 вместо 81 → 89»: ретро-прибавка ложилась на все
    // уровни повторно. Здесь ретро нет вовсе — число каждый раз собирается
    // из слагаемых заново, поэтому накопить лишнее не на чем.
    const c = character({
      classes: [cls({ level: 6 })],
      abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
      hpLump: 30,
      hpRolls: [5, 5, 5],
    });
    const once = deriveSheet(c).maxHitPoints.value;
    const twice = deriveSheet(deriveSheet(c) && c).maxHitPoints.value;
    expect(twice).toBe(once);
    expect(once).toBe(30 + 15 + 2 * 6);
  });

  it("лист без слагаемых честно помечается непересчитанным", () => {
    // Импорт из Long Story Short копирует hp-max строкой и hpLump не ставит.
    const c = character({ hitPointMax: "81", hpLump: null });
    const hp = deriveSheet(c).maxHitPoints;
    expect(hp.value).toBe(81);
    expect(hp.stale).toBeTruthy();
  });

  it("незаполненные хиты остаются нулём, а не превращаются в единицу", () => {
    // На живой базе есть листы с пустым полем хитов: приложение показывает
    // пусто, и подставлять туда 1 значит выдумать число за Мастера.
    const hp = deriveSheet(character({ hitPointMax: "", hpLump: null })).maxHitPoints;
    expect(hp.value).toBe(0);
    expect(hp.stale).toBeTruthy();
  });

  it("хиты не уходят в ноль при отрицательном Телосложении", () => {
    const c = character({
      classes: [cls({ level: 3 })],
      abilities: { str: 10, dex: 10, con: 1, int: 10, wis: 10, cha: 10 },
      hpLump: 3,
      hpRolls: [],
    });
    expect(deriveSheet(c).maxHitPoints.value).toBe(1);
  });
});

describe("пассивное восприятие, заклинательство и скорость", () => {
  it("пассивное восприятие — 10 плюс навык, с истощением", () => {
    const perception = "Perception";
    const c = character({
      classes: [cls({ level: 5 })],
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
      skillProfs: { [perception]: 1 },
    });
    expect(deriveSheet(c).passivePerception.value).toBe(10 + 3 + 3);

    // В шпаргалках истощение раньше не вычиталось, в листе вычиталось —
    // расхождение сведено сюда, в правило листа.
    const tired = { ...c, exhaustion: 1 };
    expect(deriveSheet(tired).passivePerception.value).toBe(10 + 3 + 3 - 2);
  });

  it("у неколдующего заклинательства нет", () => {
    expect(deriveSheet(character({ classes: [cls({ className: "Воин", level: 5 })] })).spellcasting).toBe(null);
  });

  it("СЛ и атака заклинаний считаются от характеристики класса", () => {
    const c = character({
      classes: [cls({ className: "Друид", level: 5, spellcastingAbility: "Мудрость" })],
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
    });
    const s = deriveSheet(c).spellcasting!;
    expect(s.ability).toBe("wis");
    expect(s.saveDc.value).toBe(8 + 4 + 3);
    expect(s.attackBonus.value).toBe(4 + 3);
  });

  it("истощение бьёт по атаке заклинанием, но не по СЛ", () => {
    const c = character({
      classes: [cls({ className: "Друид", level: 5, spellcastingAbility: "Мудрость" })],
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
      exhaustion: 1,
    });
    const s = deriveSheet(c).spellcasting!;
    expect(s.saveDc.value).toBe(8 + 4 + 3);
    expect(s.attackBonus.value).toBe(4 + 3 - 2);
  });

  it("истощение снимает по 5 футов скорости", () => {
    const c = character({ speeds: { ...emptyDndCharacter().speeds, walk: 30 }, exhaustion: 2 });
    expect(deriveSheet(c).walkSpeed.value).toBe(20);
  });

  it("скорость не уходит в минус", () => {
    const c = character({ speeds: { ...emptyDndCharacter().speeds, walk: 20 }, exhaustion: 6 });
    expect(deriveSheet(c).walkSpeed.value).toBe(0);
  });
});

describe("разбор не врёт", () => {
  it("слагаемые складываются в само число у каждой величины", () => {
    const athletics = resolveSkillOriginal("Атлетика")!;
    const c = character({
      classes: [cls({ className: "Друид", level: 7, spellcastingAbility: "Мудрость" })],
      abilities: { str: 14, dex: 16, con: 14, int: 8, wis: 18, cha: 12 },
      skillProfs: { [athletics]: 2 },
      savingThrowProfs: { str: false, dex: false, con: true, int: true, wis: false, cha: false },
      exhaustion: 1,
      hpLump: 8,
      hpRolls: [5, 5, 5, 5, 5, 5],
      equipmentSections: [
        { name: "Общее", items: [item({ name: "Кожаный", armorType: "Лёгкий", ac: "11" })] },
      ],
    });
    const s = deriveSheet(c);
    for (const d of [
      s.armorClass, s.maxHitPoints, s.passivePerception, s.walkSpeed,
      s.saves.con, s.saves.str, s.skills[athletics],
      s.spellcasting!.saveDc, s.spellcasting!.attackBonus,
    ]) {
      partsAddUp(d);
    }
  });
});
