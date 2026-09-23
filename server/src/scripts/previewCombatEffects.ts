/**
 * Пробный прогон разметки боевых чисел (dndCombatEffects.ts): печатает, что
 * миграция допишет в каждую запись, и ничего не пишет. База открывается
 * только на чтение — показывать владельцу до применения.
 *
 *   npx tsx src/scripts/previewCombatEffects.ts <путь к копии app.db>
 */
import Database from "better-sqlite3";
import { planDndCombatEffects } from "../db/dndCombatEffects";

const file = process.argv[2];
if (!file) throw new Error("Укажите путь к базе");
const db = new Database(file, { readonly: true, fileMustExist: true });
const changes = planDndCombatEffects(db, { dryRun: true });
for (const c of changes) {
  console.log(`${c.id} ${c.name}`);
  for (const w of c.what) console.log(`    ${w}`);
}
console.log(`\nВсего записей: ${changes.length}`);
