import {
  companionClassId,
  companionMaxCount,
  companionStats,
  companionsAfterLongRest,
  evalCompanionFormula,
  liveCompanionsOf,
} from "../../../client/src/components/dnd/companionFormula";

// Юнит-проверка формул тел без React.
const cases: [string, number, number, number | null][] = [
  ["18", 5, 3, 18],
  ["12+int", 5, 3, 15],
  ["12+int", 5, -1, 11],
  ["5*level", 5, 3, 25],
  ["5+5*level", 5, 3, 30],
  ["5+5*level", 20, 5, 105],
  ["(5+5)*level", 3, 0, 30],
  ["2*level+int", 4, 2, 10],
  ["abc", 5, 3, null],
  ["5/level", 5, 3, null],
  ["", 5, 3, null],
];
let fails = 0;
for (const [src, lvl, mod, want] of cases) {
  const got = evalCompanionFormula(src, lvl, mod);
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "ok " : "FAIL"} "${src}" lvl=${lvl} int=${mod >= 0 ? "+" : ""}${mod} -> ${got} (want ${want})`);
}
const cannon = { hp: "5*level", ac: "18", maxCount: 1, extraCount: { feature: "Укреплённая позиция", count: 2 } };
const defender = { hp: "5+5*level", ac: "12+int", maxCount: 1 };
const classes = [{ classId: 12812, level: 5 } as never];
const abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 };
console.log("cannon lvl5:", companionStats(cannon, classes, 12812, abilities));
console.log("defender lvl5 int16:", companionStats(defender, classes, 12812, abilities));
console.log("maxCount w/o fort:", companionMaxCount(cannon, ["Мистическая пушка"]), "with:", companionMaxCount(cannon, ["Мистическая пушка", "Укреплённая позиция"]));
console.log("classId:", companionClassId(12244, [{ classId: 12812, subclassId: 12870, level: 5 } as never], (id) => (id === 12244 ? 12870 : id === 12870 ? 12812 : null)));
const comps = [
  { entryId: null, name: "Мистическая пушка", featureEntryId: 12244, hpUsed: 10 },
  { entryId: 999, name: "Волк" },
  { entryId: null, name: "Стальной защитник", featureEntryId: 12371, dead: true },
] as never[];
console.log("live cannon:", liveCompanionsOf(comps, 12244).length);
console.log("afterRest:", JSON.stringify(companionsAfterLongRest(comps, (fid) => (fid === 12244 ? { ...cannon, dismissable: true } : fid === 12371 ? defender : null))));
console.log(fails === 0 ? "ALL OK" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
