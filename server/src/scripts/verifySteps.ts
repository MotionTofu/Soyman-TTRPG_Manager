import Database from "better-sqlite3";
import { featurePools, steppedMax } from "../../../client/src/components/dnd/dndResources";
import { costSummary, formatLevelSteps, parseLevelSteps, type DndCost } from "../../../client/src/components/dnd/effects";

// Проверка скейла пула от уровня класса.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  console.log("steps(12243 thresholds):", [1, 3, 4, 5, 8, 9, 14, 15, 20].map((l) =>
    steppedMax([{ level: 3, max: 2 }, { level: 5, max: 3 }, { level: 9, max: 4 }, { level: 15, max: 5 }], l)
  ).join(","));
  console.log("parse/format:", JSON.stringify(parseLevelSteps("3:2, 5:3, 9:4, 15:5")), "|", formatLevelSteps(parseLevelSteps("3:2, x, 99:0")));
  const row = db.prepare("SELECT name, data FROM compendium_entries WHERE id = 12243").get() as { name: string; data: string };
  const cost = (JSON.parse(row.data) as { cost?: DndCost }).cost;
  console.log("cost:", JSON.stringify(cost));
  console.log("summary:", costSummary(cost));
  const feats = [{ name: row.name, description: "", entryId: 12243, cost }];
  const abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 };
  for (const lvl of [3, 5, 9, 15]) {
    const pools = featurePools(feats as never, abilities, () => lvl);
    console.log(`art level ${lvl}: max=${pools[0]?.max}`);
  }
  console.log("no resolver:", featurePools(feats as never, abilities).map((p) => p.max));
} finally {
  db.close();
}
