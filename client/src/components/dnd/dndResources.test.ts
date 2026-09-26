import { describe, expect, it } from "vitest";
import type { DndAbilityScores, DndClassEntry, DndFeature } from "../../types";
import type { ClassProgression } from "./progression";
import {
  allResources,
  featurePools,
  nameMatches,
  replicaLimits,
  showClassSuffix,
  steppedMax,
  type ClassResourceSource,
} from "./dndResources";

const abilities: DndAbilityScores = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 14 };
const entry = (className: string, level: number, classId: number, subclassName = ""): DndClassEntry =>
  ({ classId, className, subclassId: null, subclassName, level, skillChoiceOptions: [], skillChoiceCount: 0, spellcastingAbility: "" }) as DndClassEntry;
const prog = (cols: { key: string; label: string; role: string; recharge?: "long" | "short" | "none" }[], at: (l: number) => Record<string, string>): ClassProgression => ({
  columns: [{ key: "lvl", label: "Уровень", role: "level" }, ...cols] as ClassProgression["columns"],
  rows: Array.from({ length: 20 }, (_, i) => ({ lvl: String(i + 1), ...at(i + 1) })),
});

describe("пулы из таблицы развития", () => {
  const monk = prog([{ key: "ki", label: "Очки сосредоточенности", role: "resource", recharge: "short" }], (l) => ({ ki: l < 2 ? "—" : String(l) }));
  it("максимум — число из строки уровня, восстановление — из колонки", () => {
    const [r] = allResources([{ entry: entry("Монах", 5, 7), progression: monk }], abilities);
    expect(r).toMatchObject({ label: "Очки сосредоточенности", max: 5, recharge: "short", key: "prog:7:ki" });
  });
  it("прочерк в таблице — пула нет", () => {
    expect(allResources([{ entry: entry("Монах", 1, 7), progression: monk }], abilities)).toEqual([]);
  });
});

describe("пулы по формуле", () => {
  it("Возложение рук — уровень Паладина × 5", () => {
    const r = allResources([{ entry: entry("Паладин [Paladin]", 3, 1) }], abilities);
    expect(r.find((x) => x.label === "Возложение рук")?.max).toBe(15);
  });
  it("Вдохновение барда — модификатор Харизмы, минимум 1, на коротком отдыхе", () => {
    const r = allResources([{ entry: entry("Бард", 1, 2) }], { ...abilities, cha: 8 });
    expect(r.find((x) => x.label === "Вдохновение барда")).toMatchObject({ max: 1, recharge: "short" });
  });
  it("Избранный враг из таблицы не дублируется формулой", () => {
    const ranger = prog([{ key: "fe", label: "Избранный враг", role: "resource" }], () => ({ fe: "2" }));
    const r = allResources([{ entry: entry("Следопыт", 1, 3), progression: ranger }], abilities);
    expect(r.filter((x) => x.label === "Избранный враг")).toHaveLength(1);
  });
  it("Чародейные выстрелы — только у подкласса, модификатор Интеллекта", () => {
    expect(allResources([{ entry: entry("Воин", 3, 4) }], abilities).some((x) => x.key === "arcane_shot")).toBe(false);
    const r = allResources([{ entry: entry("Воин", 3, 4, "Чародейный стрелок [Arcane Archer]") }], abilities);
    expect(r.find((x) => x.key === "arcane_shot")?.max).toBe(3);
  });
});

describe("свои пулы умений", () => {
  const f = (entryId: number, cost: DndFeature["cost"], name = "Умение"): DndFeature => ({ entryId, name, cost }) as DndFeature;
  it("одно умение дважды не даёт двух пулов", () => {
    const cost = { kind: "uses", ownResource: true, amount: 2 } as DndFeature["cost"];
    expect(featurePools([f(1, cost), f(1, cost)])).toHaveLength(1);
  });
  it("максимум: ступени по уровню, потом модификатор, потом число", () => {
    const steps = { kind: "uses", ownResource: true, amount: 9, levelSteps: [{ level: 3, max: 2 }, { level: 9, max: 4 }] } as DndFeature["cost"];
    expect(featurePools([f(1, steps)], abilities, () => 10)[0].max).toBe(4);
    const byAbility = { kind: "uses", ownResource: true, maxAbility: "int" } as DndFeature["cost"];
    expect(featurePools([f(2, byAbility)], abilities)[0].max).toBe(3);
    const low = { kind: "uses", ownResource: true, maxAbility: "int" } as DndFeature["cost"];
    expect(featurePools([f(3, low)], { ...abilities, int: 6 })[0].max).toBe(1);
  });
  it("«в день» восстанавливается долгим отдыхом, «короткий» — коротким", () => {
    const short = { kind: "uses", ownResource: true, amount: 1, per: "short_rest" } as DndFeature["cost"];
    const day = { kind: "uses", ownResource: true, amount: 1, per: "day" } as DndFeature["cost"];
    expect(featurePools([f(1, short), f(2, day)]).map((p) => p.recharge)).toEqual(["short", "long"]);
  });
  it("без записи справочника пула нет", () => {
    expect(featurePools([{ name: "Вписано руками", cost: { kind: "uses", ownResource: true, amount: 1 } } as DndFeature])).toEqual([]);
  });
});

describe("ступени по уровню", () => {
  it("наибольший порог не выше уровня; ниже первого — первый", () => {
    const s = [{ level: 3, max: 2 }, { level: 5, max: 3 }, { level: 9, max: 4 }];
    expect(steppedMax(s, 6)).toBe(3);
    expect(steppedMax(s, 1)).toBe(2);
    expect(steppedMax(s, null)).toBeNull();
  });
});

describe("реплики Артефактора", () => {
  const artificer = prog(
    [
      { key: "sch", label: "Схемы", role: "replica_schemes" },
      { key: "it", label: "Предметы", role: "replica_items" },
    ],
    (l) => ({ sch: l < 2 ? "—" : String(Math.min(8, 2 + Math.floor(l / 2))), it: l < 2 ? "—" : String(Math.min(6, 1 + Math.floor(l / 2))) })
  );
  const schemes = [
    { entryId: 1, minLevel: 2 },
    { entryId: 2, minLevel: 6 },
  ] as ClassResourceSource["replicateSchemes"];
  it("пределы по таблице и схемы, доступные по уровню", () => {
    const [l] = replicaLimits([{ entry: entry("Артефактор", 5, 9), progression: artificer, replicateSchemes: schemes }]);
    expect(l).toMatchObject({ schemes: 4, items: 3, level: 5 });
    expect(l.available.map((s) => s.entryId)).toEqual([1]);
  });
  it("класс без схем блока не получает", () => {
    expect(replicaLimits([{ entry: entry("Артефактор", 5, 9), progression: artificer }])).toEqual([]);
  });
});

describe("подпись класса у пулов", () => {
  it("подкласс корнем не считается", () => {
    expect(showClassSuffix([{ entry: entry("Воин", 3, 4) }, { entry: entry("Мастер боевых искусств", 3, 40), subOf: 4 }])).toBe(false);
    expect(showClassSuffix([{ entry: entry("Воин", 3, 4) }, { entry: entry("Жрец", 1, 5) }])).toBe(true);
  });
  it("«Воин [Fighter]» — тот же класс, что «Воин»", () => {
    expect(nameMatches("Воин [Fighter]", "Воин")).toBe(true);
    expect(nameMatches("Воинственный", "Воин")).toBe(false);
  });
});
