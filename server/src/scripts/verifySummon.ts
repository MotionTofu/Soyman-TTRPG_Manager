import Database from "better-sqlite3";
import {
  blueprintFromEntryData,
  companionMaxCount,
  companionStats,
  companionsAfterLongRest,
  evalCompanionFormula,
  liveSummonOf,
} from "../../../client/src/components/dnd/companionFormula";

// Проверка призыва: чертёж из БД + формулы с кругом + жизненный цикл.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const row = db.prepare("SELECT name, data FROM compendium_entries WHERE id = 14812").get() as { name: string; data: string };
  const bp = blueprintFromEntryData(JSON.parse(row.data) as Record<string, unknown>);
  console.log("blueprint:", JSON.stringify(bp));
  if (!bp) process.exit(1);
  const classes = [{ classId: 12812, level: 7 } as never];
  const abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 };
  for (const circle of [1, 2, 4]) {
    console.log(`circle ${circle}:`, companionStats(bp, classes, 12812, abilities, circle));
  }
  console.log("formula 5+5*spell @3:", evalCompanionFormula("5+5*spell", 7, 3, 3));
  console.log("maxCount:", companionMaxCount(bp, []));
  const comps = [
    { entryId: null, name: "Гомункул-слуга", spellEntryId: 14812, spellLevel: 2, hpUsed: 5 },
    { entryId: 999, name: "Волк" },
  ] as never[];
  console.log("live:", liveSummonOf(comps, 14812).length);
  const after = companionsAfterLongRest(comps, (c) =>
    c.spellEntryId != null
      ? blueprintFromEntryData(JSON.parse((db.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(c.spellEntryId) as { data: string }).data) as Record<string, unknown>)
      : null
  );
  console.log("afterRest changed:", after !== null, JSON.stringify(after));
  console.log("ALL OK");
} finally {
  db.close();
}
