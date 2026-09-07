import Database from "better-sqlite3";
import { featurePools } from "../../../client/src/components/dnd/dndResources";
import { checksLabel, costSummary, effectsLabel, type DndCheck, type DndCost, type DndEffect } from "../../../client/src/components/dnd/effects";

// Проверка пакета строк с пулами.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const rows = db.prepare(
    `SELECT id, parent_id, name, level, data FROM compendium_entries WHERE
      id IN (12373, 12538) OR (parent_id IN (12843, 12919, 12942) AND name IN
      ('Бурлящий котёл','Полёт лазутчика','Притяжка стража','Безошибочный путь'))
      ORDER BY id`
  ).all() as { id: number; parent_id: number; name: string; level: number; data: string }[];
  const feats = [];
  for (const r of rows) {
    const d = JSON.parse(r.data) as { checks?: DndCheck[]; effects?: DndEffect[]; cost?: DndCost; casting_timing?: string; casting_timing_other?: string };
    console.log(`[${r.id}] ${r.name} par=${r.parent_id} lvl=${r.level} timing=${d.casting_timing ?? "-"}${d.casting_timing_other ? ` (${d.casting_timing_other})` : ""}`);
    console.log(`   bonus="${checksLabel(d.checks ?? [], 7, 15)}" damage="${effectsLabel(d.effects ?? [], d.checks ?? [])}" cost="${costSummary(d.cost)}"`);
    feats.push({ name: r.name, description: "", entryId: r.id, cost: d.cost });
  }
  const abilities = { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 };
  console.log("pools(INT18):", featurePools(feats as never, abilities).map((p) => `${p.label} max=${p.max}/${p.recharge}`));
} finally {
  db.close();
}
