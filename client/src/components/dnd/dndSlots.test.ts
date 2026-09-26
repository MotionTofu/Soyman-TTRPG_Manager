import { describe, expect, it } from "vitest";
import type { ClassProgression } from "./progression";
import {
  arcanumCountByCircle,
  arcanumTopCircle,
  arcanumUnlockedCircles,
  casterKind,
  computeSpellSlots,
  effectiveCasterLevel,
  highestCircle,
} from "./dndSlots";

// Таблицы — в том же виде, что в справочнике: колонка уровня и ячейки
// «**1**-4, **2**-3» одной строкой. Строки 1–20 строятся из функции.
function table(slotsAt: (level: number) => string, extra: Record<string, (l: number) => string> = {}): ClassProgression {
  const extraCols = Object.keys(extra).map((role) => ({ key: role, label: role, role: role as never }));
  return {
    columns: [
      { key: "lvl", label: "Уровень", role: "level" },
      { key: "slots", label: "Ячейки", role: "slots_packed" },
      ...extraCols,
    ],
    rows: Array.from({ length: 20 }, (_, i) => ({
      lvl: String(i + 1),
      slots: slotsAt(i + 1),
      ...Object.fromEntries(Object.entries(extra).map(([k, f]) => [k, f(i + 1)])),
    })),
  };
}
// Полный заклинатель 5.5: сколько ячеек каждого круга на уровне заклинателя.
const FULL: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const packed = (row: number[]) => row.map((n, i) => `**${i + 1}**-${n}`).join(", ");
const full = table((l) => packed(FULL[l - 1]));
// Половинчатый (Паладин): до 5 круга, ячейки с 1 уровня (5.5).
const half = table((l) => packed(FULL[Math.max(0, Math.ceil(l / 2) - 1)].slice(0, 5)));
// Третьеразрядный (Мистический рыцарь): с 3 уровня, до 4 круга.
const third = table((l) => (l < 3 ? "-" : packed(FULL[Math.max(0, Math.ceil(l / 3) - 1)].slice(0, 4))));
// Колдун: ячеек нет, есть договор магии.
const warlock: ClassProgression = {
  columns: [
    { key: "lvl", label: "Уровень", role: "level" },
    { key: "pc", label: "Ячейки", role: "pact_slots" },
    { key: "pl", label: "Круг", role: "pact_level" },
  ],
  rows: Array.from({ length: 20 }, (_, i) => ({
    lvl: String(i + 1),
    pc: String(i + 1 >= 17 ? 4 : i + 1 >= 11 ? 3 : i + 1 >= 2 ? 2 : 1),
    pl: String(Math.min(5, Math.ceil((i + 1) / 2))),
  })),
};

describe("тип заклинателя выводится из самой таблицы", () => {
  it("полный, половинчатый, третьеразрядный, без ячеек", () => {
    expect(casterKind(full)).toBe("full");
    expect(casterKind(half)).toBe("half");
    expect(casterKind(third)).toBe("third");
    expect(casterKind(warlock)).toBe("none");
    expect(casterKind(undefined)).toBe("none");
  });
});

describe("ячейки одного класса", () => {
  it("берутся строкой самого класса, а не общей формулой", () => {
    const r = computeSpellSlots([{ level: 5, progression: half }]);
    expect(r.basis).toBe("single");
    expect(r.slots.slice(0, 3)).toEqual([4, 2, 0]);
  });
  it("Мистический рыцарь получает ячейки из таблицы подкласса", () => {
    const r = computeSpellSlots([{ level: 7, progression: undefined, subProgression: third }]);
    expect(highestCircle(r.slots)).toBe(2);
  });
  it("у Воина без подкласса ячеек нет", () => {
    expect(computeSpellSlots([{ level: 7 }]).basis).toBe("none");
  });
});

describe("многоклассье", () => {
  it("уровень заклинателя: полный целиком, половинчатый вниз, треть вниз", () => {
    expect(effectiveCasterLevel([{ level: 3, progression: full }, { level: 5, progression: half }, { level: 5, progression: undefined, subProgression: third }])).toBe(3 + 2 + 1);
  });
  it("Артефактор округляет половину вверх", () => {
    expect(effectiveCasterLevel([{ level: 3, progression: half, roundUp: true }])).toBe(2);
    expect(effectiveCasterLevel([{ level: 3, progression: half }])).toBe(1);
  });
  it("ячейки — строкой полного заклинателя на суммарном уровне", () => {
    // Волшебник 3 + Паладин 4 → уровень заклинателя 5: 4/3/2.
    const r = computeSpellSlots([{ level: 3, progression: full }, { level: 4, progression: half }]);
    expect(r.basis).toBe("multiclass");
    expect(r.slots.slice(0, 4)).toEqual([4, 3, 2, 0]);
  });
  it("без полного заклинателя таблица берётся из справочника", () => {
    const r = computeSpellSlots([{ level: 4, progression: half }, { level: 6, progression: undefined, subProgression: third }], [full]);
    // 2 + 2 = уровень 4 → 4/3.
    expect(r.slots.slice(0, 3)).toEqual([4, 3, 0]);
  });
  it("договор магии идёт своей дорожкой и в уровень не входит", () => {
    const r = computeSpellSlots([{ level: 5, progression: warlock }, { level: 2, progression: full }]);
    expect(r.pact).toEqual({ count: 2, circle: 3 });
    expect(r.slots.slice(0, 2)).toEqual([3, 0]);
  });
});

describe("таинственный арканум", () => {
  it("открывается по уровню колдуна", () => {
    expect(arcanumUnlockedCircles(10)).toEqual([]);
    expect(arcanumUnlockedCircles(15)).toEqual([6, 7, 8]);
  });
  it("пипсы кругов — число строк арканума, ниже 6 круга нет", () => {
    const byLevel = Array.from({ length: 9 }, () => [] as { arcanum?: boolean }[]);
    byLevel[0] = [{ arcanum: true }];
    byLevel[5] = [{ arcanum: true }, {}];
    byLevel[6] = [{ arcanum: true }];
    expect(arcanumCountByCircle(byLevel)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0]);
    expect(arcanumTopCircle(byLevel)).toBe(7);
  });
});
