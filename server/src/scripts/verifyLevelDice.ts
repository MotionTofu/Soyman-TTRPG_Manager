import Database from "better-sqlite3";
import { checksLabel, effectsLabel, resolveLevelDice, type DndCheck, type DndEffect } from "../../../client/src/components/dnd/effects";

// Проверка кубов от уровня: шаги из БД + подписи строк на уровнях 3/9/15.
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true });
try {
  const rows = db.prepare(
    "SELECT id, name, data FROM compendium_entries WHERE id IN (15791,15792,15793,12540)"
  ).all() as { id: number; name: string; data: string }[];
  for (const r of rows) {
    const d = JSON.parse(r.data) as { checks?: DndCheck[]; effects?: DndEffect[] };
    const steps = (d.effects ?? []).map((e) => `${e.id}:${JSON.stringify(e.levelDice ?? null)}`).join(" ");
    console.log(`[${r.id}] ${r.name} steps=${steps}`);
    for (const lvl of [3, 9, 15]) {
      const eff = resolveLevelDice(d.effects ?? [], lvl);
      console.log(`   lvl ${lvl}: damage="${effectsLabel(eff, d.checks ?? [])}"`);
    }
  }
  console.log("no level:", resolveLevelDice([{ id: "i1", type: "damage", when: "always", dice: "2к8", levelDice: [{ level: 9, dice: "3к8" }] }], null)[0].dice);
} finally {
  db.close();
}
