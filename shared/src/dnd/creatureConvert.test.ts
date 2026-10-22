import { describe, expect, it } from "vitest";
import { convertLegacyCreature, parseUses, type SpellLookup } from "./creatureConvert";
import { dragon, fanatic, goblin, hexer, lich, mage } from "./__fixtures__/bestiary55";

// Справочник заклинаний — ровно те, что встречаются в образцах.
const SPELLS: Record<string, number> = {
  "магическая рука": 0, "магический доспех": 1, "мелкие фокусы": 0, "обнаружение магии": 1, "свет": 0,
  "невидимость": 2, "огненный шар": 3, "конус холода": 5, "полёт": 3,
  "малая иллюзия": 0, "масло": 1, "слепота/глухота": 2, "фейское сияние": 1,
  "тавматургия": 0, "приказ": 1, "паралич гуманоида": 2,
  "обнаружение мыслей": 2, "рассеивание магии": 3, "удар молнии": 3,
  "дверь в пространстве": 4, "оживление мертвецов": 3, "планарный переход": 7,
  "перст смерти": 7, "слово силы: смерть": 9, "тайновидение": 5, "цепь молний": 6,
};
const lookup: SpellLookup = (name) => {
  const key = name.toLowerCase().replace(/ё/g, "е");
  const hit = Object.entries(SPELLS).find(([n]) => n.replace(/ё/g, "е") === key);
  return hit ? { entryId: 1000 + hit[1], name: hit[0][0].toUpperCase() + hit[0].slice(1), level: hit[1] } : null;
};

describe("parseUses", () => {
  it("понимает запасы книги в любом написании", () => {
    expect(parseUses("перезарядка 5–6")).toEqual({ kind: "recharge", min: 5 });
    expect(parseUses("Перезарядка 4‑6")).toEqual({ kind: "recharge", min: 4 });
    expect(parseUses("перезарядка 6")).toEqual({ kind: "recharge", min: 6 });
    expect(parseUses("3 в день")).toEqual({ kind: "day", count: 3, lairCount: null });
    expect(parseUses("3 в день или 4 в день в логове")).toEqual({ kind: "day", count: 3, lairCount: 4 });
    expect(parseUses("1/день")).toEqual({ kind: "day", count: 1, lairCount: null });
    expect(parseUses("перезарядка после короткого или долгого отдыха")).toEqual({ kind: "rest", rest: "short" });
  });

  it("условие — не запас, смешанная пометка — в разбор", () => {
    expect(parseUses("только в форме вампира")).toBeNull();
    expect(parseUses("1/день; Требуется стихийное ядро")).toBe("unknown");
  });
});

describe("convertLegacyCreature", () => {
  it("гоблин: поля без потерь, текстовые хвосты импорта сняты", () => {
    const { data, review } = convertLegacyCreature(goblin, lookup);
    expect(review).toEqual([]);
    expect(data!.armorClass.value).toBe(15);
    expect(data!.actions.map((a) => a.name)).toEqual(["Скимитар", "Короткий лук"]);
    expect(data!.bonusActions[0].name).toBe("Проворное бегство");
    expect(data).not.toHaveProperty("sizeTypeAlignment");
    expect(data).not.toHaveProperty("legendaryActions");
  });

  it("дракон: дыхание расклеено, устойчивость и легендарка в полях", () => {
    const { data, review } = convertLegacyCreature(dragon, lookup);
    expect(review).toEqual([]);
    expect(data!.actions.map((a) => a.name)).toEqual(["Мультиатака", "Раздирание", "Холодное дыхание"]);
    expect(data!.actions[1].description).toMatch(/урона Холодом\.$/);
    expect(data!.actions[2].uses).toEqual({ kind: "recharge", min: 5 });
    expect(data!.actions[2].description).toMatch(/^Испытание Выносливости: СЛ 19/);
    expect(data!.traits.map((t) => t.name)).toEqual(["Хождение по льду"]);
    expect(data!.legendary).toMatchObject({
      resistanceEnabled: true, resistanceCount: 3, resistanceLairCount: 4,
      actionsEnabled: true, actionPoints: 3, actionPointsLair: 4,
    });
    expect(data!.legendary.actions.map((a) => [a.name, !!a.oncePerTurn])).toEqual([
      ["Ледяная вспышка", true], ["Пугающее присутствие", true], ["Наскок", false],
    ]);
    expect(data!.notes).not.toMatch(/Использования легендарных/);
  });

  it("маг: заклинания по частоте, запасы бонусного и реакции", () => {
    const { data, review } = convertLegacyCreature(mage, lookup);
    expect(review).toEqual([]);
    expect(data!.actions.map((a) => a.name)).toEqual(["Мультиатака", "Волшебная вспышка"]);
    const sc = data!.spellcasting;
    expect(sc).toMatchObject({ enabled: true, ability: "int", saveDC: 14, attackBonus: null, timing: "action" });
    expect(sc.spells.filter((s) => s.frequency === "atwill").map((s) => s.name)).toEqual([
      "Магическая рука", "Магический доспех", "Мелкие фокусы", "Обнаружение магии", "Свет",
    ]);
    expect(sc.spells.find((s) => s.name === "Огненный шар")).toMatchObject({ frequency: "perday", perDayCount: 2, description: "4-й круг", level: 3 });
    expect(sc.spells.find((s) => s.name === "Конус холода")).toMatchObject({ perDayCount: 1, entryId: 1005 });
    expect(data!.bonusActions[0]).toMatchObject({ name: "Туманный шаг", uses: { kind: "day", count: 3 } });
    expect(data!.reactions[0]).toMatchObject({ name: "Защитная магия", uses: { kind: "day", count: 3 } });
  });

  it("лич: «Слово силы: смерть» не путается с группой, заметки без правила легендарки", () => {
    const { data, review } = convertLegacyCreature(lich, lookup);
    expect(review).toEqual([]);
    expect(data!.spellcasting.spells.find((s) => s.name === "Слово силы: смерть")).toMatchObject({ perDayCount: 1 });
    expect(data!.notes).toBe("Снаряжение: Сумка с компонентами");
    expect(data!.legendary.actionPoints).toBe(3);
  });

  it("группы без знаков между ними: «Тавматургия 2 в день: Приказ 1 в день: …»", () => {
    const { data, review } = convertLegacyCreature(fanatic, lookup);
    expect(review).toEqual([]);
    expect(data!.spellcasting).toMatchObject({ ability: "wis", saveDC: 12, attackBonus: 4 });
    expect(data!.spellcasting.spells.map((s) => [s.name, s.perDayCount])).toEqual([
      ["Свет", null], ["Тавматургия", null], ["Приказ", 2], ["Паралич гуманоида", 1],
    ]);
  });

  it("имена в «ёлочках» и с двоеточием впереди чистятся", () => {
    const quoted = {
      ...goblin,
      actions: [{ name: "Заклинания", description: "Гоблин сотворяет одно из описанных ниже заклинаний и использует Интеллект (СЛ испытаний против заклинаний 13) в качестве заклинательной характеристики. Неограниченно: «Малая иллюзия» 1 в день каждое: : Масло" }],
    };
    const { data, review } = convertLegacyCreature(quoted, lookup);
    expect(review).toEqual([]);
    expect(data!.spellcasting.spells.map((s) => s.name)).toEqual(["Малая иллюзия", "Масло"]);
  });

  it("заклинания нет в справочнике — существо остаётся как было, причина названа", () => {
    const { data, review } = convertLegacyCreature(hexer, (n, o) => (n === "Масло" ? null : lookup(n, o)));
    expect(data).toBeNull();
    expect(review).toEqual(["Действия: заклинание «Масло» не найдено в справочнике"]);
  });

  it("склейка без границы предложения — в разбор, а не угадывание", () => {
    const glued = {
      ...dragon,
      actions: [{ name: "Заклинания", description: "Дракон сотворяет одно из описанных ниже заклинаний и использует Харизму (СЛ испытаний против заклинаний 17) в качестве заклинательной характеристики. Неограниченно: Обнаружение магии 1 в день каждое: Тайновидение Огненное дыхание (перезарядка 5–6). Испытание Ловкости: СЛ 21." }],
    };
    const { data, review } = convertLegacyCreature(glued, lookup);
    expect(data).toBeNull();
    expect(review.some((r) => /без границы предложения/.test(r))).toBe(true);
  });

  it("хиты: среднее не сходится с костями — в разбор; типографский минус понимается", () => {
    const lost = convertLegacyCreature({ ...goblin, hitPoints: "13 (9к10 36)" }, lookup);
    expect(lost.data).toBeNull();
    expect(lost.review[0]).toMatch(/^Хиты «13 \(9к10 36\)»: среднее 13 не сходится с костями \(49\)/);
    const minus = convertLegacyCreature({ ...goblin, hitPoints: "1 (1к4 − 1)" }, lookup);
    expect(minus.data!.hitPoints).toMatchObject({ diceCount: 1, dieSize: 4, bonus: -1 });
  });

  it("тип: скобки уточнения не рвут мировоззрение, размер в любом роде", () => {
    const { data } = convertLegacyCreature({ ...goblin, sizeTypeAlignment: "Средний гуманоид (человек, перевёртыш), хаотично-злой" }, lookup);
    expect(data).toMatchObject({ size: "Средний", creatureType: "Гуманоид", creatureTags: "человек, перевёртыш", alignment: "Хаотично-злой" });
    const tiny = convertLegacyCreature({ ...goblin, sizeTypeAlignment: "Крохотная аберрация, нейтрально-злая" }, lookup);
    expect(tiny.data).toMatchObject({ size: "Крошечный", creatureType: "Аберрация", creatureTags: "" });
  });

  it("уже разобранное не трогается", () => {
    const first = convertLegacyCreature(goblin, lookup).data!;
    expect(convertLegacyCreature(first, lookup)).toEqual({ data: null, review: [] });
  });
});
