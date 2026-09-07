import Database from "better-sqlite3";
import { featurePools } from "../../../client/src/components/dnd/dndResources";
import { costSummary, type DndCost } from "../../../client/src/components/dnd/effects";

// Сквозная проверка INT-пулов: costs из БД -> featurePools -> максимумы.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const ids = [12108, 12586, 12472, 12669];
  const feats = ids.map((id) => {
    const row = db.prepare("SELECT name, data FROM compendium_entries WHERE id = ?").get(id) as { name: string; data: string };
    const data = JSON.parse(row.data) as { cost?: DndCost };
    return { name: row.name, description: "", entryId: id, cost: data.cost };
  });
  for (const abilities of [
    { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
    { str: 10, dex: 10, con: 10, int: 8, wis: 10, cha: 10 },
  ]) {
    console.log(`INT ${abilities.int}:`);
    for (const p of featurePools(feats as never, abilities)) {
      console.log(`  ${p.label}: max=${p.max}`);
    }
  }
  for (const f of feats) {
    console.log(`summary [${f.name}]: ${costSummary(f.cost)}`);
  }
} finally {
  db.close();
}
