// Снаряжение из Long Story Short: связь со справочником, настройка и то, что
// надето. Функция чистая — справочник подаётся списком, база не нужна, и
// каждый случай сверки КЗ виден на входе целиком.

import { describe, it, expect } from "vitest";
import { emptyDndCharacter } from "@soyman/shared";
import type { DndCharacterData } from "@soyman/shared";
import { settleImportedGear, type GearEntry } from "./lssGear";

let nextId = 1;
function entry(name: string, data: Record<string, unknown>, kind = "equipment", extra: Partial<GearEntry> = {}): GearEntry {
  return { id: nextId++, kind, name, aliases: [], nameOriginal: "", data, ...extra };
}

// Поля как в живом справочнике D&D 5.5.
const chainMail = entry("Кольчуга", { armor_type: "Тяжёлый доспех", ac: "16", dex_bonus: false, category: "Доспехи" });
const chainShirt = entry("Кольчужная рубаха", { armor_type: "Средний доспех", ac: "13", max_dex_bonus: "2", dex_bonus: true });
const hide = entry("Шкурный доспех", { armor_type: "Средний доспех", ac: "12", max_dex_bonus: "2", dex_bonus: true });
const studded = entry("Проклёпанный кожаный доспех", { armor_type: "Лёгкий доспех", ac: "12", dex_bonus: true });
const shield = entry("Щит", { armor_type: "Щит", ac: "2", dex_bonus: false });
const bolts = entry("Болты", { category: "Прочие предметы" });
const manifold = entry("Многообразный инструмент", { attunement: true, item_type: "Чудесные предметы" }, "magic_item");
// В живом справочнике прибавка к КЗ у колец пока не размечена; здесь она
// есть, чтобы проверить само правило.
const ringOfProtection = entry("Кольцо защиты", { attunement: true, ac_bonus: "+1", item_type: "Кольца" }, "magic_item");

const ENTRIES = [chainMail, chainShirt, hide, studded, shield, bolts, manifold, ringOfProtection];

function hero(dex: number, over: Partial<DndCharacterData> = {}): DndCharacterData {
  return {
    ...emptyDndCharacter(),
    classes: [{ classId: null, className: "Изобретатель", subclassId: null, subclassName: "", level: 3, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "" }],
    abilities: { str: 10, dex, con: 10, int: 10, wis: 10, cha: 10 },
    ...over,
  };
}

function settle(over: Partial<Parameters<typeof settleImportedGear>[0]>) {
  return settleImportedGear({
    character: hero(16),
    rawNames: [],
    entries: ENTRIES,
    attunedNames: [],
    lssAc: null,
    lssShield: false,
    ...over,
  });
}

const worn = (r: ReturnType<typeof settleImportedGear>) => r.items.filter((i) => i.equipped).map((i) => i.name);

describe("связь со справочником", () => {
  it("количество выносится из названия, связь ищется по чистому имени", () => {
    const r = settle({ rawNames: ["Болты (15)", "8x Болты", "Дорожная одежда"] });
    expect(r.items[0]).toMatchObject({ name: "Болты", qty: "15", entryId: bolts.id });
    expect(r.items[1]).toMatchObject({ name: "Болты", qty: "8", entryId: bolts.id });
    expect(r.items[2].entryId ?? null).toBeNull();
  });

  it("уточнение в скобках отбрасывается вторым кругом, прямое имя главнее", () => {
    const r = settle({ rawNames: ["Кольчуга (средняя)", "Кольчужная рубаха"] });
    expect(r.items[0]).toMatchObject({ name: "Кольчуга (средняя)", entryId: chainMail.id, armorType: "Тяжёлый доспех", ac: "16" });
    expect(r.items[1].entryId).toBe(chainShirt.id);
  });

  it("находит по оригинальному имени и синониму", () => {
    const tool = entry("Воровские инструменты", {}, "equipment", { nameOriginal: "Thieves' Tools", aliases: ["Отмычки"] });
    const r = settle({ rawNames: ["Thieves' Tools", "Отмычки"], entries: [...ENTRIES, tool] });
    expect(r.items.map((i) => i.entryId)).toEqual([tool.id, tool.id]);
  });
});

describe("настройка", () => {
  it("совпавшее имя отмечается настроенным, несовпавшее возвращается для Заметок", () => {
    const r = settle({
      rawNames: ["Многообразный инструмент", "Кольцо с ячейкой заклинаний."],
      attunedNames: ["Многообразный инструмент", "Кольцо восстановления заклинаний"],
    });
    expect(r.items[0].attuned).toBe(true);
    expect(r.items[1].attuned).toBeFalsy();
    expect(r.unmatchedAttuned).toEqual(["Кольцо восстановления заклинаний"]);
  });
});

describe("что надето — по КЗ из LSS", () => {
  it("доспех, с которым сходится КЗ; щит снят, раз снят в LSS", () => {
    // Ловкость 16: Кольчуга 16 без Ловкости, рубаха 13 + 2 = 15.
    const r = settle({ rawNames: ["Кольчуга (средняя)", "Кольчужная рубаха", "Щит", "Болты (15)"], lssAc: 16 });
    expect(worn(r)).toEqual(["Кольчуга (средняя)"]);
    expect(r.warning).toBeNull();
    expect(r.summary).toBe("Надето по КЗ 16 из LSS: Кольчуга (средняя). Щит не надет (так в LSS).");
  });

  it("щит надевается по флагу LSS и входит в сверку", () => {
    const r = settle({ rawNames: ["Кольчуга", "Щит"], lssAc: 18, lssShield: true });
    expect(worn(r)).toEqual(["Кольчуга", "Щит"]);
    expect(r.summary).toBe("Надето по КЗ 18 из LSS: Кольчуга, Щит.");
  });

  it("не сошлось — не отмечено ничего, и об этом предупреждение", () => {
    const r = settle({ rawNames: ["Кольчуга", "Щит"], lssAc: 17 });
    expect(worn(r)).toEqual([]);
    expect(r.summary).toBe("КЗ 17 из LSS не сходится с доспехами в инвентаре — надетое не отмечено.");
    expect(r.warning).toBe("КЗ 17 из LSS не сходится с доспехами в инвентаре — надетое не отмечено. Отметьте надетое вручную.");
  });

  it("два разных доспеха дают одно число — не угадываем", () => {
    // Ловкость 10: шкурный 12 + 0 и проклёпанный 12 + 0.
    const r = settle({ character: hero(10), rawNames: ["Шкурный доспех", "Проклёпанный кожаный доспех"], lssAc: 12 });
    expect(worn(r)).toEqual([]);
    expect(r.summary).toBe(
      "КЗ 12 из LSS подходит к нескольким доспехам (Шкурный доспех, Проклёпанный кожаный доспех) — надетое не отмечено."
    );
    expect(r.warning).toContain("Отметьте надетое вручную.");
  });

  it("одна и та же запись двумя строками — не двусмысленность, надевается первая", () => {
    const r = settle({ rawNames: ["Кольчуга", "Кольчуга"], lssAc: 16 });
    expect(r.items.map((i) => !!i.equipped)).toEqual([true, false]);
    expect(r.warning).toBeNull();
  });

  it("настроенный предмет с прибавкой к КЗ участвует и надевается, если с ним сходится", () => {
    const r = settle({ rawNames: ["Кольчуга", "Кольцо защиты"], attunedNames: ["Кольцо защиты"], lssAc: 17 });
    expect(worn(r)).toEqual(["Кольчуга", "Кольцо защиты"]);
    expect(r.warning).toBeNull();
  });

  it("ненастроенное кольцо в сверку не идёт", () => {
    const r = settle({ rawNames: ["Кольчуга", "Кольцо защиты"], lssAc: 17 });
    expect(worn(r)).toEqual([]);
    expect(r.warning).not.toBeNull();
  });

  it("КЗ сходится без доспеха — ничего не надето и не о чем предупреждать", () => {
    // Ловкость 16: 10 + 3.
    const r = settle({ rawNames: ["Кольчуга", "Болты"], lssAc: 13 });
    expect(worn(r)).toEqual([]);
    expect(r.warning).toBeNull();
    expect(r.summary).toBe("КЗ 13 из LSS сходится без доспеха — ничего не надето.");
  });

  it("сверка считает защиту без доспехов по правилам листа", () => {
    // Монах, Ловкость 16, Мудрость 16: 10 + 3 + 3.
    const monk = hero(16, {
      classes: [{ classId: null, className: "Монах", subclassId: null, subclassName: "", level: 3, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "" }],
      abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 16, cha: 10 },
      classFeatures: [{ name: "Защита без доспехов", description: "" } as DndCharacterData["classFeatures"][number]],
    });
    const r = settle({ character: monk, rawNames: ["Болты"], lssAc: 16 });
    expect(r.warning).toBeNull();
  });

  it("в LSS щит надет, а щита в инвентаре нет — предупреждение", () => {
    const r = settle({ rawNames: ["Кольчуга"], lssAc: 18, lssShield: true });
    expect(worn(r)).toEqual([]);
    expect(r.summary).toBe("В LSS надет щит, но щита из справочника в инвентаре нет — надетое не отмечено.");
    expect(r.warning).toContain("Отметьте надетое вручную.");
  });

  it("сохранённое КЗ листа сверку не подменяет", () => {
    // Без этого deriveSheet отдаёт сохранённое число, когда ничего не
    // надето, и «без доспеха» сходилось бы с любым КЗ.
    const r = settle({ character: hero(16, { armorClass: "17" }), rawNames: ["Кольчуга"], lssAc: 17 });
    expect(worn(r)).toEqual([]);
    expect(r.warning).not.toBeNull();
  });

  it("КЗ в экспорте нет — ничего не отмечено, без предупреждения", () => {
    const r = settle({ rawNames: ["Кольчуга"], lssAc: null });
    expect(worn(r)).toEqual([]);
    expect(r.warning).toBeNull();
    expect(r.summary).toBe("КЗ в экспорте LSS не указан — надетое не отмечено.");
  });

  it("пустой инвентарь без КЗ — итога нет", () => {
    expect(settle({}).summary).toBe("");
  });
});
