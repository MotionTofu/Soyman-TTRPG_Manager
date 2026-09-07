import Database from "better-sqlite3";
import { featurePools } from "../../../client/src/components/dnd/dndResources";
import { costSummary, type DndCost } from "../../../client/src/components/dnd/effects";

// Проверка строк мастерового-6: цены и пулы.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const rows = db.prepare(
    `SELECT id, name, data FROM compendium_entries WHERE parent_id = 12812 AND name IN
      ('Зарядка магического предмета','Поглощение магического предмета','Преобразование магического предмета')`
  ).all() as { id: number; name: string; data: string }[];
  console.log(`rows: ${rows.length}`);
  const feats = [];
  for (const r of rows) {
    const d = JSON.parse(r.data) as { cost?: DndCost; casting_timing?: string };
    console.log(`[${r.id}] ${r.name} timing=${d.casting_timing} cost=${JSON.stringify(d.cost)} summary=${costSummary(d.cost)}`);
    feats.push({ name: r.name, description: "", entryId: r.id, cost: d.cost });
  }
  const abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 };
  console.log("pools:", featurePools(feats as never, abilities).map((p) => `${p.label} max=${p.max}/${p.recharge}`));
  const par = db.prepare("SELECT data FROM compendium_entries WHERE id = 12537").get() as { data: string };
  console.log("parent timing:", (JSON.parse(par.data) as { casting_timing?: string }).casting_timing ?? "(none)");
} finally {
  db.close();
}
