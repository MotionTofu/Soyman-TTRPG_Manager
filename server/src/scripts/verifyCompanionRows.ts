import Database from "better-sqlite3";
import { featurePools } from "../../../client/src/components/dnd/dndResources";
import { checksLabel, costSummary, effectsLabel, type DndCheck, type DndCost, type DndEffect } from "../../../client/src/components/dnd/effects";

// Проверка строк спутников: подписи действий и пулы из данных.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const rows = db.prepare(
    `SELECT id, parent_id, name, level, data FROM compendium_entries
      WHERE parent_id IN (12870, 12895, 12919) AND name IN
        ('Огнемёт (пушка)','Силовая баллиста (пушка)','Защитник (пушка)',
         'Силовой разрыв','Починка защитника','Гигантский размер',
         'Взрывная пушка','Магическая встряска')
      ORDER BY parent_id, id`
  ).all() as { id: number; parent_id: number; name: string; level: number; data: string }[];
  const feats = [];
  for (const r of rows) {
    const d = JSON.parse(r.data) as { checks?: DndCheck[]; effects?: DndEffect[]; cost?: DndCost; casting_timing?: string; companion?: unknown };
    const atk = 7;
    const dc = 15;
    console.log(`[${r.id}] ${r.name} (par=${r.parent_id} lvl=${r.level} timing=${d.casting_timing ?? "-"})`);
    console.log(`   bonus="${checksLabel(d.checks ?? [], atk, dc)}" damage="${effectsLabel(d.effects ?? [])}" cost="${costSummary(d.cost)}"${d.companion ? " +companion" : ""}`);
    feats.push({ name: r.name, description: "", entryId: r.id, cost: d.cost });
  }
  const abilities = { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 };
  console.log("pools:", featurePools(feats as never, abilities).map((p) => `${p.label} max=${p.max}/${p.recharge}`));
  // Чертежи
  for (const id of [12244, 12371]) {
    const row = db.prepare("SELECT name, data FROM compendium_entries WHERE id = ?").get(id) as { name: string; data: string };
    console.log(`blueprint [${row.name}]:`, JSON.stringify((JSON.parse(row.data) as { companion?: unknown }).companion));
  }
} finally {
  db.close();
}
