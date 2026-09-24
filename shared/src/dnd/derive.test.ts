import { describe, it, expect } from "vitest";
import { deriveSheet, proficiencyBonusForLevel, creatureInitiativeModifier, hitPointLumpFor, weaponEffects } from "./derive";
import { emptyDndCharacter } from "./normalize";
import type { DndCharacterData, DndClassEntry, DndEquipmentItem, DndFeature, DndSpellEntry } from "./types";
import type { DndEffect } from "./effects";
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

// «Крепкий» с эффектом из справочника — так его подставляет withLiveEffects.
const TOUGH: DndFeature = { name: "Крепкий", description: "", effects: [{ id: "feat-hp", type: "hit_points", when: "always", perLevel: 2 }] };

function defense(name: string, over: Partial<DndEffect>): DndFeature {
  return { name, description: "", effects: [{ id: "d", type: "defense", when: "always", ...over }] } as DndFeature;
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

  it("защита без доспехов монаха — формула из эффекта, гасится щитом", () => {
    const base = {
      abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 16, cha: 10 },
      classes: [cls({ className: "Монах", level: 5 })],
      classFeatures: [defense("Защита без доспехов", { acBase: { base: 10, abilities: ["dex", "wis"] }, armorCondition: "no_armor_no_shield" })],
    } as Partial<DndCharacterData>;

    const bare = deriveSheet(character(base)).armorClass;
    expect(bare.value).toBe(10 + 2 + 3);
    partsAddUp(bare);

    const withShield = deriveSheet(character({
      ...base,
      equipmentSections: [{ name: "Общее", items: [item({ name: "Щит", armorType: "Щит", ac: "2" })] }],
    })).armorClass;
    // Монаху щит умение гасит: 10 + Ловкость + щит, без Мудрости.
    expect(withShield.value).toBe(10 + 2 + 2);
    expect(withShield.inactive).toEqual([{ label: "Защита без доспехов", reason: "со щитом" }]);
  });

  it("варвару щит умение не гасит", () => {
    const c = character({
      abilities: { str: 10, dex: 14, con: 16, int: 10, wis: 10, cha: 10 },
      classes: [cls({ className: "Варвар", level: 5 })],
      classFeatures: [defense("Защита без доспехов", { acBase: { base: 10, abilities: ["dex", "con"] }, armorCondition: "no_armor" })],
      equipmentSections: [{ name: "Общее", items: [item({ name: "Щит", armorType: "Щит", ac: "2" })] }],
    });
    expect(deriveSheet(c).armorClass.value).toBe(10 + 2 + 3 + 2);
  });

  it("имя умения без эффекта КЗ не меняет — правило живёт в данных", () => {
    const c = character({
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 16, cha: 10 },
      classes: [cls({ className: "Монах", level: 5 })],
      classFeatures: [feature("Защита без доспехов")],
    });
    expect(deriveSheet(c).armorClass.value).toBe(12);
  });

  it("«Оборона» даёт +1 только в доспехе и объясняет, почему нет", () => {
    const oborona = defense("Оборона", { flat: 1, armorCondition: "armor" });
    const mail = item({ name: "Кольчуга", armorType: "Тяжёлый", ac: "16", dexBonus: false });
    const worn = deriveSheet(character({ feats: [oborona], equipmentSections: [{ name: "", items: [mail] }] })).armorClass;
    expect(worn.value).toBe(17);
    expect(worn.parts.map((p) => p.label)).toEqual(["Кольчуга", "Оборона"]);
    partsAddUp(worn);

    const bare = deriveSheet(character({ feats: [oborona] })).armorClass;
    expect(bare.value).toBe(10);
    expect(bare.inactive).toEqual([{ label: "Оборона", reason: "нет доспеха" }]);
  });

  it("«Доспехи мага» считаются, только пока действуют, и уступают лучшей формуле", () => {
    const mageArmor = { entryId: 1, name: "Доспехи мага", prepared: 1, effects: [{ id: "d", type: "defense", when: "always", acBase: { base: 13, abilities: ["dex"] }, armorCondition: "no_armor" }] } as DndSpellEntry;
    const base = {
      abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
      spellsByLevel: [[mageArmor], [], [], [], [], [], [], [], []],
    } as Partial<DndCharacterData>;
    expect(deriveSheet(character(base)).armorClass.value).toBe(13);
    const on = deriveSheet(character({ ...base, activeSpells: ["Доспехи мага"] })).armorClass;
    expect(on.value).toBe(16);
    expect(on.parts[0]).toEqual({ label: "Доспехи мага", value: 13 });
  });

  it("заклинание на концентрации действует через неё («Щит веры»)", () => {
    const sof = { entryId: 2, name: "Щит веры", prepared: 1, concentration: true, effects: [{ id: "d", type: "defense", when: "always", flat: 2 }] } as DndSpellEntry;
    const base = { spellsByLevel: [[sof], [], [], [], [], [], [], [], []] } as Partial<DndCharacterData>;
    expect(deriveSheet(character(base)).armorClass.value).toBe(10);
    expect(deriveSheet(character({ ...base, concentration: "Щит веры" })).armorClass.value).toBe(12);
  });

  it("«Щит веры» на союзнике не меняет КЗ заклинателя", () => {
    const sof = { entryId: 2, name: "Щит веры", prepared: 1, concentration: true, effects: [{ id: "d", type: "defense", when: "always", flat: 2 }] } as DndSpellEntry;
    const base = { spellsByLevel: [[sof], [], [], [], [], [], [], [], []], concentration: "Щит веры" } as Partial<DndCharacterData>;
    expect(deriveSheet(character({ ...base, concentrationOnOther: "Щит веры" })).armorClass.value).toBe(10);
    // Устаревшая пометка от другого заклинания не мешает.
    expect(deriveSheet(character({ ...base, concentrationOnOther: "Благословение" })).armorClass.value).toBe(12);
  });

  it("наложенное на меня другими считается, как своё", () => {
    const got = { name: "Щит веры", entryId: 2, effects: [{ id: "d", type: "defense", when: "always", flat: 2 }] as DndEffect[] };
    const ac = deriveSheet(character({ receivedSpells: [got] })).armorClass;
    expect(ac.value).toBe(12);
    expect(ac.parts.map((p) => p.label)).toContain("Щит веры");
  });

  it("«Дубовая кожа» доводит КЗ до 17, но не снижает больший", () => {
    const bark = { name: "Дубовая кожа", entryId: 3, effects: [{ id: "d", type: "defense", when: "always", acMin: 17 }] as DndEffect[] };
    const low = deriveSheet(character({ receivedSpells: [bark] })).armorClass;
    expect(low.value).toBe(17);
    partsAddUp(low);
    const plate = item({ name: "Латы", armorType: "Тяжёлый", ac: "18", dexBonus: false });
    expect(deriveSheet(character({ receivedSpells: [bark], equipmentSections: [{ name: "", items: [plate] }] })).armorClass.value).toBe(18);
  });

  it("«Мастер средних доспехов» поднимает предел Ловкости до 3 только у среднего", () => {
    const mam = defense("Мастер средних доспехов", { mediumDexCap: 3 });
    const dex16 = { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 };
    const half = item({ name: "Полулаты", armorType: "Средний", ac: "15", maxDexBonus: "2" });
    const ac = deriveSheet(character({ abilities: dex16, feats: [mam], equipmentSections: [{ name: "", items: [half] }] })).armorClass;
    expect(ac.value).toBe(18);
    const light = item({ name: "Кожаный", armorType: "Лёгкий", ac: "11" });
    expect(deriveSheet(character({ abilities: dex16, feats: [mam], equipmentSections: [{ name: "", items: [light] }] })).armorClass.value).toBe(14);
  });

  it("прибавка при условии не входит в КЗ, но видна", () => {
    const shield = item({
      name: "Ловящий стрелы щит",
      armorType: "Щит",
      ac: "2",
      requiresAttunement: true,
      attuned: true,
      effects: [{ id: "d", type: "defense", when: "always", flat: 2, situational: "против дальнобойных атак" }],
    });
    const ac = deriveSheet(character({ equipmentSections: [{ name: "", items: [shield] }] })).armorClass;
    expect(ac.value).toBe(12);
    expect(ac.situational).toEqual([{ label: "Ловящий стрелы щит", text: "+2 против дальнобойных атак" }]);
  });

  it("«Защитник» переносит бонус в КЗ, не больше своего", () => {
    const sword = (acShift: number) =>
      item({ name: "Защитник", weaponDamage: "1к8 рубящий", weaponAttackMelee: true, magicBonus: 3, acShiftable: true, acShift });
    expect(deriveSheet(character({ equipmentSections: [{ name: "", items: [sword(2)] }] })).armorClass.value).toBe(12);
    expect(deriveSheet(character({ equipmentSections: [{ name: "", items: [sword(9)] }] })).armorClass.value).toBe(13);
  });

  it("вещь с настройкой даёт КЗ только настроенной", () => {
    const cloak = (attuned: boolean) => item({ name: "Плащ защиты", requiresAttunement: true, attuned, effects: [{ id: "d", type: "defense", when: "always", flat: 1 }] });
    expect(deriveSheet(character({ equipmentSections: [{ name: "", items: [cloak(true)] }] })).armorClass.value).toBe(11);
    const off = deriveSheet(character({ equipmentSections: [{ name: "", items: [cloak(false)] }] })).armorClass;
    expect(off.value).toBe(10);
    expect(off.inactive).toEqual([{ label: "Плащ защиты", reason: "не настроено" }]);
  });

  it("кольцо защиты: +1 к КЗ и ко всем спасброскам, пока настроено", () => {
    const ring = item({
      name: "Кольцо защиты",
      requiresAttunement: true,
      attuned: true,
      effects: [
        { id: "a", type: "defense", when: "always", flat: 1 },
        { id: "s", type: "roll_modifier", when: "always", appliesTo: "save", flat: 1 },
      ],
    });
    const sheet = deriveSheet(character({ equipmentSections: [{ name: "", items: [ring] }] }));
    expect(sheet.armorClass.value).toBe(11);
    expect(sheet.saves.wis.value).toBe(1);
    partsAddUp(sheet.saves.wis);
  });

  it("ненастроенная вещь не даёт и инициативы", () => {
    const eff = [{ id: "i", type: "roll_modifier", when: "always", appliesTo: "initiative", flat: 5 }] as DndEffect[];
    const c = character({ equipmentSections: [{ name: "", items: [item({ name: "Кольцо", requiresAttunement: true, attuned: false, effects: eff })] }] });
    expect(deriveSheet(c).initiative.value).toBe(0);
  });

  it("сохранённое поле armorClass не читается, пока есть что надето", () => {
    const c = character({
      armorClass: "99",
      abilities: { str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10 },
      equipmentSections: [{ name: "Общее", items: [item({ name: "Кожаный", armorType: "Лёгкий", ac: "11" })] }],
    });
    expect(deriveSheet(c).armorClass.value).toBe(11 + 1);
    expect(deriveSheet(c).armorClass.stale).toBeUndefined();
  });

  it("если не надето ничего, а сохранённое есть — показывается сохранённое", () => {
    // Лист, импортированный из Long Story Short: снаряжение не отмечено
    // надетым, и вычисление даёт голые 10 при настоящих 15. Показывать 10
    // значит молча ухудшить то, что Мастер видит.
    const c = character({ armorClass: "15", abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
    const ac = deriveSheet(c).armorClass;
    expect(ac.value).toBe(15);
    expect(ac.stale).toBeTruthy();
  });

  it("пустое сохранённое поле не мешает вычислению", () => {
    const c = character({ armorClass: "", abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 } });
    const ac = deriveSheet(c).armorClass;
    expect(ac.value).toBe(13);
    expect(ac.stale).toBeUndefined();
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
      feats: [TOUGH],
    });
    expect(deriveSheet(c).maxHitPoints.value).toBe(20 + 2 * 4);
  });

  it("хиты черты — по эффекту, а не по имени (гриллинг черт 2026-09-24)", () => {
    const base = {
      classes: [cls({ level: 4 })],
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      hpLump: 20,
      hpRolls: [],
    };
    expect(deriveSheet(character({ ...base, feats: [feature("Крепкий")] })).maxHitPoints.value).toBe(20);
    const fortitude: DndFeature = { name: "Дар стойкости", description: "", effects: [{ id: "feat-hp", type: "hit_points", when: "always", flat: 40 }] };
    const hp = deriveSheet(character({ ...base, feats: [fortitude] })).maxHitPoints;
    expect(hp.value).toBe(60);
    expect(hp.parts.some((p) => p.label === "Дар стойкости" && p.value === 40)).toBe(true);
  });

  describe("обратный вывод кубовой части из готового максимума", () => {
    // Импорт из Long Story Short знает только итоговый максимум. Кубовая часть
    // выводится обратно той же формулой, по которой лист складывает число, —
    // и лист обязан показать ровно тот максимум, что был в LSS.
    it("Изобретатель 3 с Телосложением 16 и максимумом 30 — кубов 21", () => {
      // По правилам 8 + 5 + 5 = 18, но игрок бросал кость и выбросил на 3
      // больше: броски LSS не отдаёт, поэтому весь излишек ложится в кубы.
      const c = character({
        classes: [cls({ className: "Изобретатель", level: 3 })],
        abilities: { str: 7, dex: 16, con: 16, int: 18, wis: 14, cha: 7 },
      });
      const lump = hitPointLumpFor(c, 30);
      expect(lump).toBe(21);
      const hp = deriveSheet({ ...c, hpLump: lump, hpRolls: [], hpMiscPerLevel: 0 }).maxHitPoints;
      expect(hp.value).toBe(30);
      expect(hp.stale).toBeUndefined();
    });

    it("«Крепкий», мультикласс и отрицательное Телосложение дают тот же максимум", () => {
      const c = character({
        classes: [cls({ className: "Воин", level: 4 }), cls({ className: "Плут", level: 3 })],
        abilities: { str: 10, dex: 10, con: 8, int: 10, wis: 10, cha: 10 },
        feats: [TOUGH],
        hpMiscPerLevel: 1,
      });
      const lump = hitPointLumpFor(c, 55);
      // 7 уровней × (−1 Телосложения + 2 «Крепкого» + 1 прочего) = 14.
      expect(lump).toBe(55 - 14);
      expect(deriveSheet({ ...c, hpLump: lump, hpRolls: [] }).maxHitPoints.value).toBe(55);
    });
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

  it("временный максимум работает и в минус", () => {
    // Похищение жизни и т.п.: временная поправка отрицательная, итог ниже
    // складского, а разбор честно показывает слагаемое минусом.
    const c = character({
      classes: [cls({ level: 3 })],
      abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
      hpLump: 20,
      hpRolls: [5, 5],
      hitPointMaxTemp: "-7",
    });
    const hp = deriveSheet(c).maxHitPoints;
    expect(hp.value).toBe(20 + 10 + 2 * 3 - 7);
    expect(hp.parts.some((p) => p.label === "Временный предел" && p.value === -7)).toBe(true);
    partsAddUp(hp);
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

describe("пассивные проницательность и анализ", () => {
  it("считаются по тому же правилу, что и восприятие", () => {
    const c = character({
      classes: [cls({ level: 5 })],
      abilities: { str: 10, dex: 10, con: 10, int: 14, wis: 16, cha: 10 },
      skillProfs: { Insight: 1 },
    });
    const sheet = deriveSheet(c);
    // Проницательность — Мудрость (+3) плюс владение (+3).
    expect(sheet.passiveInsight.value).toBe(10 + 3 + 3);
    // Анализ — Интеллект (+2), владения нет.
    expect(sheet.passiveInvestigation.value).toBe(10 + 2);
  });
});

describe("грузоподъёмность", () => {
  it("без удвоений — Сила ×15", () => {
    const c = character({ abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
    expect(deriveSheet(c).carryCapacity.value).toBe(16 * 15);
  });

  it("«Мощное телосложение» удваивает — раньше модуль этого не знал", () => {
    const c = character({
      abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      speciesFeatures: [feature("Мощное телосложение")],
    });
    const carry = deriveSheet(c).carryCapacity;
    expect(carry.value).toBe(16 * 15 * 2);
    expect(carry.parts.map((p) => p.label)).toContain("Мощное телосложение");
  });

  it("удвоения ищутся во всех четырёх списках умений и не складываются дважды", () => {
    const c = character({
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      speciesFeatures: [feature("Мощное телосложение")],
      feats: [feature("Мощное телосложение")],
      specialAbilities: [feature("Увеличение")],
    });
    // Одно и то же имя дважды — одно удвоение; «Увеличение» — второе.
    expect(deriveSheet(c).carryCapacity.value).toBe(10 * 15 * 4);
  });
});

describe("бонус инициативы", () => {
  /** Умение с размеченной прибавкой к инициативе. */
  function initFeature(name: string, over: Partial<DndEffect>): DndFeature {
    return {
      name,
      description: "",
      effects: [{ id: "e1", type: "roll_modifier", when: "always", appliesTo: "initiative", ...over }],
    } as DndFeature;
  }

  it("без умений — чистая Ловкость", () => {
    const c = character({ abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 } });
    expect(deriveSheet(c).initiative.value).toBe(3);
  });

  it("сохранённое поле листа не читается", () => {
    // До этого модуля в `initiative` лежал вписанный руками модификатор,
    // устаревавший при любой правке Ловкости. Теперь это брошенное число, и
    // производная величина о нём знать не должна — иначе бросок сложится с
    // модификатором.
    const c = character({
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      initiative: 17,
    });
    expect(deriveSheet(c).initiative.value).toBe(2);
  });

  it("«Мастер на все руки» даёт половину бонуса мастерства вниз", () => {
    // На 5-м уровне бонус мастерства +3, половина вниз — +1.
    const c = character({
      classes: [cls({ className: "Бард", level: 5 })],
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      classFeatures: [initFeature("Мастер на все руки", { proficiency: "half" })],
    });
    const init = deriveSheet(c).initiative;
    expect(init.value).toBe(2 + 1);
    expect(init.parts.map((p) => p.label)).toContain("Мастер на все руки");
  });

  it("«Бдительный» даёт полный бонус мастерства", () => {
    const c = character({
      classes: [cls({ level: 5 })],
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      feats: [initFeature("Бдительный", { proficiency: "full" })],
    });
    expect(deriveSheet(c).initiative.value).toBe(2 + 3);
  });

  it("половина бонуса мастерства не складывается с полным", () => {
    // Бард с «Бдительным»: полный бонус уже посчитан, и «Мастер на все руки»
    // сверху не идёт — так и читается его формулировка («к проверке, которая
    // иным образом не использует ваш бонус мастерства»). Сложить оба значит
    // показать за столом число на 1-3 больше настоящего.
    const c = character({
      classes: [cls({ className: "Бард", level: 9 })], // бонус мастерства +4
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      classFeatures: [initFeature("Мастер на все руки", { proficiency: "half" })],
      feats: [initFeature("Бдительный", { proficiency: "full" })],
    });
    const init = deriveSheet(c).initiative;
    expect(init.value).toBe(2 + 4);
    expect(init.parts.map((p) => p.label)).toContain("Бдительный");
    expect(init.parts.map((p) => p.label)).not.toContain("Мастер на все руки");
  });

  it("плоская прибавка складывается с бонусом мастерства", () => {
    // Непересечение — только про доли бонуса мастерства. Кольцо +1 идёт своим
    // слагаемым и ни с чем не конфликтует.
    const c = character({
      classes: [cls({ className: "Бард", level: 9 })],
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      classFeatures: [initFeature("Мастер на все руки", { proficiency: "half" })],
      specialAbilities: [initFeature("Страж", { flat: 2 })],
    });
    // 2 (Ловкость) + 2 (половина от +4) + 2 (плоская) = 6.
    expect(deriveSheet(c).initiative.value).toBe(6);
  });

  it("надетая вещь прибавляет, снятая — нет", () => {
    const ring = (equipped: boolean) =>
      item({
        name: "Кольцо расторопности",
        equipped,
        effects: [
          { id: "e1", type: "roll_modifier", when: "always", appliesTo: "initiative", flat: 1 },
        ],
      });
    const withItem = (equipped: boolean) =>
      character({
        abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
        equipmentSections: [{ name: "Общее", items: [ring(equipped)] }],
      });
    expect(deriveSheet(withItem(true)).initiative.value).toBe(3);
    expect(deriveSheet(withItem(false)).initiative.value).toBe(2);
  });

  it("эффект по другому броску в инициативу не лезет", () => {
    const c = character({
      classes: [cls({ level: 5 })],
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      feats: [initFeature("Меткий охотник", { appliesTo: "attack", proficiency: "full" })],
    });
    expect(deriveSheet(c).initiative.value).toBe(2);
  });

  it("неразмеченный эффект со свободным текстом не считается", () => {
    // Три живые записи справочника держат цель в тексте («1к4 к броскам атаки
    // или спасброскам»). Читать его — значит выдумывать число за Мастера.
    const c = character({
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      specialAbilities: [
        {
          name: "Благословение",
          description: "",
          effects: [
            { id: "i1", type: "roll_modifier", when: "always", modifier: "1к4 к броскам атаки или спасброскам" },
          ],
        } as DndFeature,
      ],
    });
    expect(deriveSheet(c).initiative.value).toBe(2);
  });

  it("ручная поправка складывается, истощение вычитается", () => {
    const c = character({
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      initiativeMisc: "+2",
      exhaustion: 1,
    });
    // 2 (Ловкость) + 2 (прочее) − 2 (истощение) = 2.
    expect(deriveSheet(c).initiative.value).toBe(2);
  });

  it("слагаемые складываются ровно в число", () => {
    const c = character({
      classes: [cls({ className: "Бард", level: 9 })],
      abilities: { str: 10, dex: 18, con: 10, int: 10, wis: 10, cha: 10 },
      classFeatures: [initFeature("Мастер на все руки", { proficiency: "half" })],
      initiativeMisc: "-1",
      exhaustion: 2,
    });
    partsAddUp(deriveSheet(c).initiative);
  });
});

describe("модификатор инициативы существа", () => {
  function creature(over: Record<string, unknown> = {}) {
    return {
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      initiativeBonus: null,
      ...over,
    } as unknown as Parameters<typeof creatureInitiativeModifier>[0];
  }

  it("объявленный бонус побеждает Ловкость", () => {
    // Существо с Ловкостью 10 (модификатор 0) и объявленным «Инициатива +5».
    // До этой правки трекер брал 0 и бросал по Ловкости, игнорируя
    // заполненное поле.
    expect(creatureInitiativeModifier(creature({ initiativeBonus: 5 }))).toBe(5);
  });

  it("без объявленного бонуса — модификатор Ловкости", () => {
    expect(
      creatureInitiativeModifier(
        creature({ abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 } })
      )
    ).toBe(3);
  });

  it("ноль — это «плюс ноль», а не «не задано»", () => {
    // Проверка на ложность съела бы законный ноль у неповоротливого существа
    // и подставила бы модификатор Ловкости.
    expect(
      creatureInitiativeModifier(
        creature({ initiativeBonus: 0, abilities: { str: 10, dex: 18, con: 10, int: 10, wis: 10, cha: 10 } })
      )
    ).toBe(0);
  });

  it("отрицательный бонус сохраняется", () => {
    expect(creatureInitiativeModifier(creature({ initiativeBonus: -2 }))).toBe(-2);
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

describe("прибавки боевых стилей к оружию", () => {
  function style(name: string, over: Partial<DndEffect>): DndFeature {
    return { name, description: "", effects: [{ id: "s", type: "roll_modifier", when: "always", ...over }] } as DndFeature;
  }

  it("«Стрельба из лука» — +2 к атаке только дальнобойным", () => {
    const c = character({ feats: [style("Стрельба из лука", { appliesTo: "attack", weapon: "ranged", flat: 2 })] });
    expect(weaponEffects(c, { ranged: true }, 2).attack).toEqual([{ label: "Стрельба из лука", value: 2 }]);
    expect(weaponEffects(c, { oneHand: true }, 2).attack).toEqual([]);
    // До инициативы и прочих бросков прибавка с фильтром оружия не доходит.
    expect(deriveSheet(c).initiative.value).toBe(0);
  });

  it("«Дуэлянт» — +2 к урону одной рукой, не двумя", () => {
    const c = character({ feats: [style("Дуэлянт", { appliesTo: "damage", weapon: "melee_one_hand", flat: 2 })] });
    expect(weaponEffects(c, { oneHand: true }, 2).damage).toEqual([{ label: "Дуэлянт", value: 2 }]);
    expect(weaponEffects(c, { twoHand: true }, 2).damage).toEqual([]);
  });

  it("«Сражение большим оружием» — минимум на кости, не число", () => {
    const c = character({ feats: [style("Сражение большим оружием", { appliesTo: "damage", weapon: "melee_two_hand", dieMinimum: 3 })] });
    const e = weaponEffects(c, { twoHand: true }, 2);
    expect(e.dieMinimum).toEqual({ value: 3, source: "Сражение большим оружием" });
    expect(e.damage).toEqual([]);
  });

  it("«Сражение двумя оружиями» возвращает модификатор в доп. атаку", () => {
    const c = character({ feats: [style("Сражение двумя оружиями", { appliesTo: "damage", weapon: "offhand_light", addAbility: true })] });
    expect(weaponEffects(c, { offhand: true }, 2).addAbility).toBe("Сражение двумя оружиями");
    expect(weaponEffects(c, { oneHand: true }, 2).addAbility).toBeNull();
  });

  it("«Сражение голыми руками» — 1к6, без оружия и щита 1к8", () => {
    const c = character({ feats: [style("Сражение голыми руками", { appliesTo: "damage", weapon: "unarmed", dice: "1к6", diceFreeHands: "1к8" })] });
    expect(weaponEffects(c, { unarmed: true }, 2).dice?.value).toBe("1к6");
    expect(weaponEffects(c, { unarmed: true }, 2).notes).toContain("1к8 с пустыми руками");
    expect(weaponEffects(c, { unarmed: true }, 2, true).dice?.value).toBe("1к8");
  });

  it("переключаемый «Дуэлянт» выключается листом и только он", () => {
    const duel = style("Дуэлянт", { appliesTo: "damage", weapon: "melee_one_hand", flat: 2, toggleable: true });
    const archery = style("Стрельба из лука", { appliesTo: "attack", weapon: "ranged", flat: 2 });
    const on = character({ feats: [duel, archery] });
    expect(weaponEffects(on, { oneHand: true }, 2).damage).toEqual([{ label: "Дуэлянт", value: 2 }]);
    const off = character({ feats: [duel, archery], effectsOff: ["Дуэлянт", "Стрельба из лука"] });
    expect(weaponEffects(off, { oneHand: true }, 2).damage).toEqual([]);
    // Непереключаемое имя в списке выключенных ничего не выключает.
    expect(weaponEffects(off, { ranged: true }, 2).attack).toEqual([{ label: "Стрельба из лука", value: 2 }]);
  });
});

describe("скорость и сопротивления от черт", () => {
  it("прибавка скорости числом идёт в пешую скорость, текстовая — нет", () => {
    const speedy: DndFeature = {
      name: "Подвижный",
      description: "",
      effects: [{ id: "s", type: "movement", when: "always", movementKind: "speed", flat: 10 }],
    };
    const textOnly: DndFeature = {
      name: "Текст",
      description: "",
      effects: [{ id: "t", type: "movement", when: "always", movementKind: "speed", distance: "скорость растёт" }],
    };
    const sheet = deriveSheet(character({ speeds: { walk: 30 } as DndCharacterData["speeds"], feats: [speedy, textOnly] }));
    expect(sheet.walkSpeed.value).toBe(40);
  });

  it("сопротивление на выбор действует только выбранным", () => {
    const portal: DndFeature = {
      name: "Портальный странник",
      description: "",
      choices: { resistances: ["Излучение"] },
      effects: [
        {
          id: "r",
          type: "resistance",
          when: "always",
          count: 1,
          options: [
            { id: 1, name: "Некротическая энергия" },
            { id: 2, name: "Излучение" },
          ],
        },
      ],
    };
    const storm: DndFeature = {
      name: "Метка шторма",
      description: "",
      effects: [{ id: "e", type: "resistance", when: "always", damageType: { id: 3, name: "Электрический" } }],
    };
    const sheet = deriveSheet(character({ damageResistances: ["Огненный"], feats: [portal, storm] }));
    expect(sheet.damageResistances).toEqual([
      { name: "Огненный", source: "" },
      { name: "Излучение", source: "Портальный странник" },
      { name: "Электрический", source: "Метка шторма" },
    ]);
  });
});
