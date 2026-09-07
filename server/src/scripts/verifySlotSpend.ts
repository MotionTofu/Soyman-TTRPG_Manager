import Database from "better-sqlite3";
import { featurePools } from "../../../client/src/components/dnd/dndResources";
import { costSummary, type DndCost } from "../../../client/src/components/dnd/effects";

const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const ids = [12244, 12243, 12371];
  const feats = ids.map((id) => {
    const row = db.prepare("SELECT name, data FROM compendium_entries WHERE id = ?").get(id) as { name: string; data: string };
    const data = JSON.parse(row.data) as { cost?: DndCost };
    return { name: row.name, description: "", entryId: id, cost: data.cost };
  });
  const abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 };
  console.log("pools:", featurePools(feats as never, abilities).map((p) => `${p.label} max=${p.max} recharge=${p.recharge}`));
  for (const f of feats) console.log(`summary [${f.name}]: ${costSummary(f.cost)}`);
} finally {
  db.close();
}
